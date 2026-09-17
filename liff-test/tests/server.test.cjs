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
test('email request uses normalized allowlist and fixed callback and clears any old linking flow',async()=>{
  let sent=0;
  mock((u,options,body)=>{
    if(u.pathname.endsWith('/allowlist')){assert.equal(u.searchParams.get('subject'),'eq.'+address);return [{}];}
    assert.equal(u.pathname,'/auth/v1/otp');assert.equal(u.searchParams.get('redirect_to'),'http://localhost:3000/auth-callback.html');assert.deepEqual(body,{email:address,create_user:true});sent++;return {};
  });
  const res=response();await emailApi(request({email:' Tester@Example.COM ',redirect:'https://attacker.example'}),res);
  assert.equal(res.code,200);assert.equal(sent,1);
  const line=res.headers['Set-Cookie'][0];assert.match(line,/HttpOnly; SameSite=Lax/);
  assert.match(line,/^mimiobo_email_flow=;.*Max-Age=0/);
});
test('disallowed email never requests an OTP',async()=>{
  mock(u=>{assert.equal(u.pathname,'/rest/v1/allowlist');return [];});
  const res=response();await emailApi(request({email:address}),res);assert.equal(res.code,403);
});
test('production email request explicitly targets the callback instead of the Site URL',async()=>{
  let sent=0;
  mock((u,options,body)=>{
    if(u.pathname==='/rest/v1/allowlist')return [{}];
    assert.equal(u.pathname,'/auth/v1/otp');
    assert.equal(u.searchParams.get('redirect_to'),'https://mimiobo-liff-test.vercel.app/auth-callback.html');
    assert.deepEqual(body,{email:address,create_user:true});sent++;return {};
  });
  const req=request({email:address,redirect_to:'https://attacker.example'});
  req.headers.host='mimiobo-liff-test.vercel.app';req.headers.origin='https://mimiobo-liff-test.vercel.app';
  const res=response();await emailApi(req,res);assert.equal(res.code,200);assert.equal(sent,1);
});
function emailRequest(){const req=request({tokenHash:'not-a-real-token-hash'});req.headers.cookie='mimiobo_email_flow='+s.sign({purpose:'email',email:address,exp:Date.now()/1000+600});return req;}
function accessRequest(){const req=emailRequest();req.body={accessToken:'test-browser-access-only'};return req;}
for(const [kind,makeRequest] of [['access-token',accessRequest],['token-hash',emailRequest]]){
  test(kind+' callback accepts valid tokens without a requesting browser cookie',async()=>{
    let resolved=0;mock((u,options,body)=>{
      if(u.pathname==='/auth/v1/verify')return {access_token:'test-access-only'};
      if(u.pathname==='/auth/v1/user')return {email:address,email_confirmed_at:now};
      assert.equal(u.pathname,'/rest/v1/rpc/resolve_identity');
      assert.deepEqual(body,{p_provider:'email',p_subject:address,p_link_token_hash:null});resolved++;return user;
    });
    const req=makeRequest();delete req.headers.cookie;req.body.linkToken='b'.repeat(64);
    const res=response();await verifyApi(req,res);
    assert.equal(res.code,200);assert.equal(resolved,1);assert.equal(res.data.userId,user);
    assert.ok(res.headers['Set-Cookie'].some(line=>line.startsWith(s.COOKIE+'=')));
  });
  test(kind+' callback denies an email outside the allowlist without a browser cookie',async()=>{
    const seen=[];global.fetch=async(url,options)=>{
      const path=new URL(url).pathname;seen.push(path);
      if(path==='/auth/v1/verify')return {ok:true,status:200,json:async()=>({access_token:'test-access-only'})};
      if(path==='/auth/v1/user')return {ok:true,status:200,json:async()=>({email:'outsider@example.com',email_confirmed_at:now})};
      assert.equal(path,'/rest/v1/rpc/resolve_identity');
      assert.deepEqual(JSON.parse(options.body),{p_provider:'email',p_subject:'outsider@example.com',p_link_token_hash:null});
      return {ok:false,status:400,json:async()=>({message:'not_allowed'})};
    };
    const req=makeRequest();delete req.headers.cookie;const res=response();await verifyApi(req,res);
    assert.equal(res.code,403);assert.deepEqual(res.data,{error:'not_allowed'});assert.equal(res.headers['Set-Cookie'],undefined);
    assert.equal(seen.at(-1),'/rest/v1/rpc/resolve_identity');
  });
  test(kind+' callback ignores expired, tampered and unrelated ordinary flow cookies',async()=>{
    const expired=s.sign({purpose:'email',email:address,linkToken:'a'.repeat(64),exp:Date.now()/1000-1});
    const valid=s.sign({purpose:'email',email:address,linkToken:'a'.repeat(64),exp:Date.now()/1000+600});
    const [payload,mac]=valid.split('.');const tampered=payload+'.'+(mac[0]==='A'?'B':'A')+mac.slice(1);
    const ordinary=s.sign({purpose:'email',email:'different@example.com',exp:Date.now()/1000+600});
    for(const flow of [expired,tampered,ordinary]){
      let resolved=0;mock((u,options,body)=>{
        if(u.pathname==='/auth/v1/verify')return {access_token:'test-access-only'};
        if(u.pathname==='/auth/v1/user')return {email:address,email_confirmed_at:now};
        assert.equal(u.pathname,'/rest/v1/rpc/resolve_identity');assert.equal(body.p_subject,address);assert.equal(body.p_link_token_hash,null);resolved++;return user;
      });
      const req=makeRequest();req.headers.cookie='mimiobo_email_flow='+flow;const res=response();await verifyApi(req,res);
      assert.equal(res.code,200);assert.equal(resolved,1);
    }
  });
  test(kind+' callback rejects a valid linking flow for a different verified email',async()=>{
    mock(u=>{
      if(u.pathname==='/auth/v1/verify')return {access_token:'test-access-only'};
      assert.equal(u.pathname,'/auth/v1/user');return {email:'different@example.com',email_confirmed_at:now};
    });
    const req=makeRequest();req.headers.cookie='mimiobo_email_flow='+s.sign({purpose:'email',email:address,linkToken:'a'.repeat(64),exp:Date.now()/1000+600});
    const res=response();await verifyApi(req,res);assert.equal(res.code,401);assert.equal(res.headers['Set-Cookie'],undefined);
  });
  test(kind+' callback rejects an invalid token without a browser cookie',async()=>{
    let calls=0;global.fetch=async url=>{
      assert.equal(new URL(url).pathname,kind==='token-hash'?'/auth/v1/verify':'/auth/v1/user');calls++;
      return {ok:false,status:401,json:async()=>({message:'invalid token'})};
    };
    const req=makeRequest();delete req.headers.cookie;const res=response();await verifyApi(req,res);
    assert.equal(res.code,401);assert.equal(calls,1);assert.equal(res.headers['Set-Cookie'],undefined);
  });
}
test('email send limit returns 429 try_later without issuing a new flow cookie',async()=>{
  global.fetch=async url=>{
    const path=new URL(url).pathname;
    if(path==='/rest/v1/allowlist')return {ok:true,status:200,json:async()=>[{}]};
    assert.equal(path,'/auth/v1/otp');return {ok:false,status:429,json:async()=>({message:'email rate limit exceeded'})};
  };
  const res=response();await emailApi(request({email:address}),res);
  assert.equal(res.code,429);assert.deepEqual(res.data,{error:'try_later'});
  assert.ok((res.headers['Set-Cookie']||[]).every(line=>line.startsWith('mimiobo_email_flow=;')&&line.includes('Max-Age=0')));
});
test('access-token callback validates with getUser and issues only an application session',async()=>{
  const seen=[];mock((u,options,body)=>{
    seen.push(u.pathname);
    if(u.pathname==='/auth/v1/user'){
      assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer test-browser-access-only');
      assert.equal(options.headers.apikey,'sb_secret_test_only');assert.equal(body,undefined);
      return {email:address,email_confirmed_at:now};
    }
    assert.equal(u.pathname,'/rest/v1/rpc/resolve_identity');
    assert.deepEqual(body,{p_provider:'email',p_subject:address,p_link_token_hash:null});return user;
  });
  const req=accessRequest();req.body.email='attacker@example.com';req.body.refreshToken='refresh-must-not-persist';
  const res=response();await verifyApi(req,res);
  assert.equal(res.code,200);assert.deepEqual(res.data,s.sessionData(user));
  assert.deepEqual(seen,['/auth/v1/user','/rest/v1/rpc/resolve_identity']);
  const lines=res.headers['Set-Cookie'];const sessionLine=lines.find(line=>line.startsWith(s.COOKIE+'='));
  assert.match(sessionLine,/HttpOnly; SameSite=Lax/);
  const payload=s.verify(sessionLine.split(';')[0].slice(s.COOKIE.length+1),'session');
  assert.equal(payload.userId,user);assert.equal(payload.provider,'email');assert.equal(payload.subject,address);
  assert.deepEqual(Object.keys(payload).sort(),['exp','provider','purpose','subject','userId']);
  assert.ok(lines.some(line=>line.startsWith('mimiobo_email_flow=;')&&line.includes('Max-Age=0')));
  assert.doesNotMatch(JSON.stringify({data:res.data,headers:res.headers,payload}),/test-browser-access-only|refresh-must-not-persist|access_token|refresh_token|accessToken|refreshToken/);
});
test('invalid access token from getUser returns 401 without identity resolution or cookies',async()=>{
  let calls=0;global.fetch=async(url,options)=>{
    assert.equal(url,'https://test.supabase.co/auth/v1/user');
    assert.equal(options.headers.Authorization,'Bearer test-browser-access-only');calls++;
    return {ok:false,status:401,json:async()=>({message:'invalid JWT'})};
  };
  const res=response();await verifyApi(accessRequest(),res);
  assert.equal(res.code,401);assert.equal(calls,1);assert.equal(res.headers['Set-Cookie'],undefined);
});
test('access-token callback rejects malformed or ambiguous credentials before upstream requests',async()=>{
  for(const body of [{accessToken:''},{accessToken:null},{accessToken:123},{accessToken:{}},{accessToken:'x'.repeat(10001)},{accessToken:'has whitespace'},{accessToken:' token'},{accessToken:'token\n'},{accessToken:'valid',tokenHash:'not-a-real-token-hash'},{accessToken:'valid',tokenHash:''}]){
    const req=accessRequest();req.body=body;const res=response();await verifyApi(req,res);
    assert.equal(res.code,400);assert.equal(res.headers['Set-Cookie'],undefined);
  }
});
test('access-token callback requires a confirmed email',async()=>{
  for(const userData of [{email:address},{email:address,email_confirmed_at:null}]){
    let calls=0;mock(u=>{assert.equal(u.pathname,'/auth/v1/user');calls++;return userData;});
    const res=response();await verifyApi(accessRequest(),res);
    assert.equal(res.code,401);assert.equal(calls,1);assert.equal(res.headers['Set-Cookie'],undefined);
  }
});
test('access-token callback preserves the email linking ticket from the signed flow',async()=>{
  const linkToken='a'.repeat(64);let resolved=0;
  mock((u,options,body)=>{
    if(u.pathname==='/auth/v1/user')return {email:address,email_confirmed_at:now};
    assert.equal(u.pathname,'/rest/v1/rpc/resolve_identity');
    assert.deepEqual(body,{p_provider:'email',p_subject:address,p_link_token_hash:s.hash(linkToken)});resolved++;return user;
  });
  const req=accessRequest();req.headers.cookie='mimiobo_email_flow='+s.sign({purpose:'email',email:address,linkToken,exp:Date.now()/1000+600});
  req.body.linkToken='b'.repeat(64);const res=response();await verifyApi(req,res);
  assert.equal(res.code,200);assert.equal(resolved,1);assert.equal(res.data.userId,user);
});
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
test('token-hash callback rejects unconfirmed email',async()=>{
  for(const userData of [{email:address},{email:address,email_confirmed_at:null}]){
    mock(u=>{if(u.pathname==='/auth/v1/verify')return {access_token:'test-only'};assert.equal(u.pathname,'/auth/v1/user');return userData;});
    const res=response();await verifyApi(emailRequest(),res);assert.equal(res.code,401);
  }
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
  const line=res.headers['Set-Cookie'].find(line=>line.startsWith('mimiobo_email_flow='));
  assert.match(line,/HttpOnly; SameSite=Lax/);
  const flow=s.verify(line.split(';')[0].slice('mimiobo_email_flow='.length),'email');
  assert.equal(flow.email,address);assert.match(flow.linkToken,/^[0-9a-f]{64}$/);assert.equal(s.hash(flow.linkToken),stored.token_hash);
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
