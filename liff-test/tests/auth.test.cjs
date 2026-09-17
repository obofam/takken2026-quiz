const {test,after}=require('node:test');const assert=require('node:assert/strict');const handler=require('../api/session');
const original=global.fetch,env={...process.env};
Object.assign(process.env,{LINE_CHANNEL_ID:'2011606963',SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'});
after(()=>{global.fetch=original;process.env=env;});
function response(){const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
const req=body=>({method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json'},body});
test('reject absent or non-string token before contacting LINE',async()=>{
 global.fetch=async()=>{assert.fail('must not contact LINE');};
 for(const idToken of [undefined,'',123,'x'.repeat(10001)]){const res=response();await handler(req({idToken}),res);assert.equal(res.code,400);}
});
test('reject unsupported method; GET now requires an authenticated cookie',async()=>{
 const res=response();await handler({method:'PATCH'},res);assert.equal(res.code,405);
 const get=response();await handler({method:'GET',headers:{}},get);assert.equal(get.code,401);
});
test('verify LINE claims and database allowlist before issuing session',async()=>{
 const valid={aud:'2011606963',iss:'https://access.line.me',exp:Date.now()/1000+100,sub:'test'};
 for(const [claims,status] of [[{...valid,aud:'other'},401],[{...valid,iss:'https://wrong.example'},401],[{...valid,exp:1},401],[{...valid,sub:''},401],[valid,403]]){
 global.fetch=async(url,options)=>{
 if(url==='https://api.line.me/oauth2/v2.1/verify'){assert.equal(options.body.get('client_id'),'2011606963');return {ok:true,json:async()=>claims};}
 assert.equal(url,'https://test.supabase.co/rest/v1/rpc/resolve_identity');const body=JSON.parse(options.body);assert.equal(body.p_provider,'line');assert.match(body.p_subject,/^[0-9a-f]{64}$/);
 return {ok:false,status:403,json:async()=>({message:'not_allowed'})};};
 const res=response();await handler(req({idToken:'dummy-not-real'}),res);assert.equal(res.code,status);assert.equal(res.data.storageKey,undefined);
 }
});
test('allowed LINE login issues a signed secure session that restores through GET',async()=>{
 const s=require('../lib/server'),user='12345678-1234-4123-8123-123456789abc',subject=s.hash('allowed-test-line-user'),seen=[];
 global.fetch=async(url,options)=>{
  const u=new URL(url);seen.push(u.pathname);
  let data;
  if(url==='https://api.line.me/oauth2/v2.1/verify'){
   assert.equal(options.body.get('id_token'),'test-line-token');
   assert.equal(options.body.get('client_id'),'2011606963');
   data={aud:'2011606963',iss:'https://access.line.me',exp:Date.now()/1000+100,sub:'allowed-test-line-user'};
  }else if(u.pathname==='/rest/v1/rpc/resolve_identity'){
   assert.deepEqual(JSON.parse(options.body),{p_provider:'line',p_subject:subject,p_link_token_hash:null});
   // The RPC owns allowlist validation; its successful result is the allowed identity.
   data=user;
  }else if(u.pathname==='/rest/v1/allowlist'){
   assert.equal(u.searchParams.get('provider'),'eq.line');assert.equal(u.searchParams.get('subject'),'eq.'+subject);data=[{provider:'line'}];
  }else{
   assert.equal(u.pathname,'/rest/v1/identities');assert.equal(u.searchParams.get('user_id'),'eq.'+user);
   assert.equal(u.searchParams.get('provider'),'eq.line');assert.equal(u.searchParams.get('subject'),'eq.'+subject);data=[{user_id:user}];
  }
  return {ok:true,status:200,json:async()=>data};
 };
 const loginReq=req({idToken:'test-line-token'});Object.assign(loginReq.headers,{host:'mimiobo-liff-test.vercel.app',origin:'https://mimiobo-liff-test.vercel.app'});
 const start=Math.floor(Date.now()/1000),res=response();await handler(loginReq,res);
 assert.equal(res.code,200);assert.deepEqual(res.data,{userId:user,storageKey:'mimiobo-test-v1-'+s.hash(user)});
 assert.equal(res.headers['Set-Cookie'].length,1);
 const line=res.headers['Set-Cookie'][0];assert.match(line,/; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
 const cookie=line.split(';')[0],token=cookie.slice(s.COOKIE.length+1),payload=s.verify(token,'session');
 assert.equal(payload.userId,user);assert.equal(payload.provider,'line');assert.equal(payload.subject,subject);
 assert.ok(payload.exp>=start+604800&&payload.exp<=Math.floor(Date.now()/1000)+604800);
 const restored=response();await handler({method:'GET',headers:{cookie}},restored);
 assert.equal(restored.code,200);assert.deepEqual(restored.data,res.data);
 assert.deepEqual(seen,['/oauth2/v2.1/verify','/rest/v1/rpc/resolve_identity','/rest/v1/allowlist','/rest/v1/identities']);
});
