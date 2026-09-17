const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const s=require('../lib/server');
const sessionApi=require('../api/session');
const emailApi=require('../api/email');
const verifyApi=require('../api/email-verify');
const linkApi=require('../api/link');
const answersApi=require('../api/answers');
const originalFetch=global.fetch,originalEnv={...process.env};
const user='12345678-1234-4123-8123-123456789abc',other='87654321-1234-4123-8123-123456789abc';
const address='tester@example.com',now='2026-01-01T00:00:00.000Z';
beforeEach(()=>{Object.assign(process.env,{SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'});global.fetch=async()=>{throw Error('unmocked fetch');};});
after(()=>{global.fetch=originalFetch;process.env=originalEnv;});
function response(){const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
function cookie(){return s.COOKIE+'='+s.sign({purpose:'session',userId:user,provider:'email',subject:address,exp:Date.now()/1000+600});}
function request(body={},method='POST'){return {method,url:'/api/answers?quiz=ep10',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json','x-mimiobo-user':user,cookie:cookie()},body};}
function mock(run){global.fetch=async(url,options)=>{assert.ok(url.startsWith('https://test.supabase.co/'));const u=new URL(url),body=options.body?JSON.parse(options.body):undefined;const data=await run(u,options,body);return {ok:true,status:200,json:async()=>data};};}
function authenticated(run){mock((u,options,body)=>{
  if(u.pathname==='/rest/v1/allowlist')return [{provider:'email'}];
  if(u.pathname==='/rest/v1/identities')return [{user_id:user}];
  return run(u,options,body);
});}
const answer=(extra={})=>({attemptId:'aaaaaaaa-1234-4123-8123-123456789abc',quizId:'ep10',questionId:'ep10-money',value:true,startedAt:now,answeredAt:now,...extra});
test('signed sessions reject tampering, expiration, wrong purpose and malformed tokens',()=>{
  const token=s.sign({purpose:'session',userId:user,exp:100});
  assert.equal(s.verify(token,'session',99).userId,user);
  assert.equal(s.verify(token,'session',100),null);assert.equal(s.verify(token,'email',1),null);
  const [body,mac]=token.split('.');assert.equal(s.verify(body+'.'+(mac[0]==='A'?'B':'A')+mac.slice(1),'session',1),null);
  for(const bad of ['',null,'x.y.z','x.x','x'.repeat(4097)])assert.equal(s.verify(bad,'session',1),null);
  process.env.SESSION_SECRET='short';assert.throws(()=>s.sign({}),e=>e.status===503);
});
test('mutations require same origin, JSON body and approved host',()=>{
  s.mutation(request());
  for(const patch of [{origin:'https://attacker.example'},{origin:undefined},{host:'production.example',origin:'https://production.example'}])assert.throws(()=>s.mutation({...request(),headers:{...request().headers,...patch}}),e=>e.status===403);
  assert.throws(()=>s.mutation({...request(),headers:{...request().headers,'content-type':'text/plain'}}),e=>e.status===415);
  assert.throws(()=>s.mutation(request([])),e=>e.status===400);
});
test('Origin-less WebViews require same-origin fetch metadata or Referer without conflicting signals',()=>{
  const check=patch=>s.mutation({...request(),headers:{...request().headers,origin:undefined,...patch}});
  for(const patch of [{'sec-fetch-site':'same-origin'},{referer:'http://localhost:3000/ep10-preview.html?x=1'},{'sec-fetch-site':'none',referer:'http://localhost:3000/'}])check(patch);
  for(const patch of [
    {},{'sec-fetch-site':'none'}, {referer:'garbage'}, {referer:'https://attacker.example/'},
    {referer:'http://localhost:3000.attacker.example/'},
    {'sec-fetch-site':'cross-site',referer:'http://localhost:3000/'},
    {'sec-fetch-site':'same-origin',referer:'https://attacker.example/'},
    {origin:'null','sec-fetch-site':'same-origin'},
    {origin:'https://attacker.example',referer:'http://localhost:3000/'},
    {origin:'','sec-fetch-site':'same-origin'},
    {origin:'http://localhost:3000','sec-fetch-site':'cross-site'},
    {origin:'http://localhost:3000','sec-fetch-site':'same-site'}
  ])assert.throws(()=>check(patch),e=>e.status===403&&e.message==='origin_not_allowed');
});
test('unexpected endpoint errors log only a fixed safe classification',async()=>{
  const originalError=console.error,logs=[];console.error=(...args)=>logs.push(args);
  try{
    for(const err of [new TypeError('secret-token-in-message'),Object.assign(new Error('secret'),{name:'secret-name',url:'secret-url',body:'secret-body'}),null]){
      const res=response();await s.endpoint(['GET'],async()=>{throw err;})(request({},'GET'),res);
      assert.equal(res.code,503);assert.deepEqual(res.data,{error:'service_unavailable'});
    }
    assert.deepEqual(logs,[['endpoint_unexpected_error',{name:'TypeError'}],['endpoint_unexpected_error',{name:'UnknownError'}],['endpoint_unexpected_error',{name:'UnknownError'}]]);
    const res=response();await s.endpoint(['GET'],async()=>s.fail(403,'not_allowed'))(request({},'GET'),res);
    assert.equal(res.code,403);assert.equal(logs.length,3);
  }finally{console.error=originalError;}
});
test('session rechecks allowlist and exact identity to support revocation',async()=>{
  for(const [allowed,identity,status] of [[false,true,403],[true,false,401],[true,true,200]]){
    mock(u=>{if(u.pathname.endsWith('/allowlist'))return allowed?[{}]:[];assert.equal(u.searchParams.get('user_id'),'eq.'+user);assert.equal(u.searchParams.get('subject'),'eq.'+address);return identity?[{user_id:user}]:[];});
    const res=response();await sessionApi(request({},'GET'),res);assert.equal(res.code,status);
    if(status===200){assert.equal(res.data.userId,user);assert.equal(res.data.storageKey,'mimiobo-test-v1-'+s.hash(user));}
  }
});
test('session rejects a stale client user header',async()=>{
  authenticated(()=>assert.fail('unexpected query'));
  const req=request({},'GET');req.headers['x-mimiobo-user']=other;
  const res=response();await sessionApi(req,res);assert.equal(res.code,401);assert.equal(res.data.error,'user_changed');
});
test('email normalization and malformed addresses',()=>{
  assert.equal(s.email('  Tester@Example.COM  '),address);
  for(const bad of [null,'no-at','x@@example.com','A <a@example.com>','a,b@example.com','x@localhost'])assert.throws(()=>s.email(bad),e=>e.status===400);
});
test('email request uses normalized allowlist and fixed callback; cookie is signed and HttpOnly',async()=>{
  let sent=0;
  mock((u,options,body)=>{
    if(u.pathname.endsWith('/allowlist')){assert.equal(u.searchParams.get('subject'),'eq.'+address);return [{}];}
    assert.equal(u.pathname,'/auth/v1/otp');assert.equal(u.searchParams.get('redirect_to'),'http://localhost:3000/auth-callback.html');assert.deepEqual(body,{email:address,create_user:true});sent++;return {};
  });
  const res=response();await emailApi(request({email:' Tester@Example.COM ',redirect:'https://attacker.example'}),res);
  assert.equal(res.code,200);assert.equal(sent,1);
  const line=res.headers['Set-Cookie'][0];assert.match(line,/HttpOnly; SameSite=Lax/);
  const token=line.split(';')[0].split('=')[1];assert.equal(s.verify(token,'email').email,address);
});
test('disallowed email never requests an OTP',async()=>{
  mock(u=>{assert.equal(u.pathname,'/rest/v1/allowlist');return [];});
  const res=response();await emailApi(request({email:address}),res);assert.equal(res.code,403);
});
function emailRequest(){const req=request({tokenHash:'not-a-real-token-hash'});req.headers.cookie='mimiobo_email_flow='+s.sign({purpose:'email',email:address,exp:Date.now()/1000+600});return req;}
test('email verification trusts auth user endpoint, not browser or verify response claims',async()=>{
  const seen=[];mock((u,options,body)=>{
    seen.push(u.pathname);
    if(u.pathname==='/auth/v1/verify'){assert.deepEqual(body,{token_hash:'not-a-real-token-hash',type:'email'});return {access_token:'test-access-only',user:{email:'untrusted@example.com'}};}
    if(u.pathname==='/auth/v1/user'){assert.equal(options.headers.Authorization,'Bearer test-access-only');return {email:address,email_confirmed_at:now};}
    assert.equal(u.pathname,'/rest/v1/rpc/resolve_identity');assert.equal(body.p_subject,address);return user;
  });
  const req=emailRequest();req.body.email='attacker@example.com';const res=response();await verifyApi(req,res);
  assert.equal(res.code,200);assert.equal(res.data.userId,user);assert.deepEqual(seen,['/auth/v1/verify','/auth/v1/user','/rest/v1/rpc/resolve_identity']);
});
test('email mismatch, unconfirmed email and absent browser flow cannot establish a session',async()=>{
  for(const userData of [{email:'different@example.com',email_confirmed_at:now},{email:address}]){
    mock(u=>{if(u.pathname==='/auth/v1/verify')return {access_token:'test-only'};assert.equal(u.pathname,'/auth/v1/user');return userData;});
    const res=response();await verifyApi(emailRequest(),res);assert.equal(res.code,401);
  }
  const req=request({tokenHash:'not-a-real-token-hash'});const res=response();await verifyApi(req,res);assert.equal(res.code,401);
});
test('link tickets require a live session and store only a hash',async()=>{
  let stored;authenticated((u,options,body)=>{assert.equal(u.pathname,'/rest/v1/link_tickets');stored=body;return null;});
  const res=response();await linkApi(request({provider:'line',userId:other}),res);
  assert.equal(res.code,200);assert.match(res.data.linkToken,/^[0-9a-f]{64}$/);assert.equal(stored.token_hash,s.hash(res.data.linkToken));assert.equal(stored.user_id,user);assert.equal(stored.provider,'line');
  const req=request({provider:'line'});delete req.headers.cookie;const denied=response();await linkApi(req,denied);assert.equal(denied.code,401);
});
test('email linking uses authenticated owner and binds ticket to normalized email',async()=>{
  let stored;authenticated((u,options,body)=>{if(u.pathname==='/rest/v1/link_tickets')stored=body;else assert.equal(u.pathname,'/auth/v1/otp');return {};});
  const res=response();await emailApi(request({email:address,link:true,userId:other}),res);
  assert.equal(res.code,200);assert.equal(stored.user_id,user);assert.equal(stored.subject,address);assert.equal(stored.provider,'email');
});
test('answer validator distinguishes unknown from unanswered and rejects invalid fields or chronology',()=>{
  assert.equal(answersApi.validate(answer({value:null})).p_value,null);
  for(const patch of [{attemptId:'not-uuid'},{quizId:'ep11'},{questionId:'other'},{value:0},{value:undefined},{answeredAt:'bad'},{startedAt:'2026-01-02T00:00:00Z'},{answeredAt:new Date(Date.now()+600000).toISOString()}])assert.throws(()=>answersApi.validate(answer(patch)),e=>e.status===400);
});
test('answer writes use cookie owner despite injected body IDs, and require matching client header',async()=>{
  let calls=0;authenticated((u,options,body)=>{assert.equal(u.pathname,'/rest/v1/rpc/save_answer');assert.equal(body.p_user_id,user);assert.equal(body.userId,undefined);calls++;return null;});
  const res=response();await answersApi(request(answer({userId:other,p_user_id:other})),res);assert.equal(res.code,200);assert.equal(calls,1);
  for(const header of [undefined,other]){const req=request(answer());req.headers['x-mimiobo-user']=header;const denied=response();await answersApi(req,denied);assert.equal(denied.code,401);}
  assert.equal(calls,1);
});
test('answer reads filter owner and quiz, paginate, and preserve null-value answers',async()=>{
  const offsets=[];authenticated(u=>{
    assert.equal(u.pathname,'/rest/v1/attempts');assert.equal(u.searchParams.get('user_id'),'eq.'+user);assert.equal(u.searchParams.get('quiz_id'),'eq.ep10');assert.equal(u.searchParams.get('limit'),'500');
    const offset=Number(u.searchParams.get('offset'));offsets.push(offset);
    return Array.from({length:offset===0?500:1},(_,i)=>({id:String(offset+i),started_at:now,answers:i===0?[{question_id:'ep10-money',value:null,answered_at:now}]:[]}));
  });
  const req=request({},'GET');req.query={quiz:'ep10',userId:other};const res=response();await answersApi(req,res);
  assert.equal(res.code,200);assert.equal(res.data.attempts.length,501);assert.deepEqual(offsets,[0,500]);assert.deepEqual(res.data.attempts[0].answers,[{value:null,at:now},null,null]);
});
test('history over 1000 is rejected rather than silently truncating records',async()=>{
  authenticated(u=>Array.from({length:Number(u.searchParams.get('offset'))===1000?1:500},(_,i)=>({id:String(i),started_at:now,answers:[]})));
  const res=response();await answersApi(request({},'GET'),res);assert.equal(res.code,409);assert.equal(res.data.error,'history_limit');
});
