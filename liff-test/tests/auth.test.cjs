const {test,after}=require('node:test');const assert=require('node:assert/strict');const handler=require('../api/session');
const original=global.fetch,env={...process.env};
Object.assign(process.env,{LINE_CHANNEL_ID:'2011606963',SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'});
after(()=>{global.fetch=original;process.env=env;});
function response(){return {code:0,data:null,setHeader(){},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
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
