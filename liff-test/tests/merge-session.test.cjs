'use strict';
// 記録をまとめたあとの /api/session：残った利用者を返す。消えた側のクッキーでも、識別が移っていれば残った利用者として通す。
const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const s=require('../lib/server');
const sessionApi=require('../api/session');
const originalFetch=global.fetch,originalEnv={...process.env};
const kept='12345678-1234-4123-8123-123456789abc',gone='87654321-1234-4123-8123-123456789abc',address='tester@example.com';
beforeEach(()=>{Object.assign(process.env,{SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only',OPEN_LOGIN:'1',LINE_CHANNEL_ID:'123'});global.fetch=async()=>{throw Error('unmocked fetch');};});
after(()=>{global.fetch=originalFetch;process.env=originalEnv;});
function response(){const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
const cookie=id=>s.COOKIE+'='+s.sign({purpose:'session',userId:id,provider:'email',subject:address,exp:Date.now()/1000+600});
// 識別の表：メールの識別は kept へ付け替え済み（消えた gone の行は無い）。owner=null なら識別そのものが無い。
function db(owner){
  global.fetch=async(url)=>{
    const u=new URL(url),reply=data=>({ok:true,status:200,json:async()=>data});
    if(u.pathname==='/rest/v1/identities'){
      const uid=u.searchParams.get('user_id');
      if(uid)return reply(uid==='eq.'+owner?[{user_id:owner,provider:'email'},{user_id:owner,provider:'line'}]:[]);
      if(u.searchParams.get('subject')==='eq.'+address)return reply(owner?[{user_id:owner}]:[]);
      return reply([]);
    }
    if(u.pathname==='/rest/v1/entitlements')return reply([{plan:'take',valid_until:null}]);
    throw Error('unexpected '+u.pathname);
  };
}
const get=id=>({method:'GET',url:'/api/session',headers:{host:'localhost:3000',cookie:cookie(id)}});
test('まとめて消えた側のクッキー：識別が残った利用者に移っていれば、その利用者として通す',async()=>{
  db(kept);const res=response();await sessionApi(get(gone),res);
  assert.equal(res.code,200);assert.equal(res.data.userId,kept);assert.deepEqual(res.data.providers,['email','line']);assert.equal(res.data.entitlements.length,1);
});
test('識別そのものが無ければ従来どおり 401',async()=>{
  db(null);const res=response();await sessionApi(get(gone),res);assert.equal(res.code,401);assert.equal(res.data.error,'login_required');
});
test('持ち主が変わっていない通常のクッキーは今までどおり',async()=>{
  db(kept);const res=response();await sessionApi(get(kept),res);assert.equal(res.code,200);assert.equal(res.data.userId,kept);
});
test('x-mimiobo-user が古い id のままなら 401（user_changed）',async()=>{
  db(kept);const res=response(),req=get(gone);req.headers['x-mimiobo-user']=gone;await sessionApi(req,res);assert.equal(res.code,401);assert.equal(res.data.error,'user_changed');
});
test('合図つきのログイン：resolve_identity が返した残る利用者 id でクッキーが出る',async()=>{
  global.fetch=async(url)=>{
    const u=new URL(url);
    if(u.hostname==='api.line.me')return {ok:true,status:200,json:async()=>({aud:'123',iss:'https://access.line.me',sub:'line-sub',exp:Date.now()/1000+300})};
    if(u.pathname==='/rest/v1/rpc/resolve_identity')return {ok:true,status:200,json:async()=>kept};
    throw Error('unexpected '+u.pathname);
  };
  const res=response();
  await sessionApi({method:'POST',url:'/api/session',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json'},body:{idToken:'tok',linkToken:'f'.repeat(64)}},res);
  assert.equal(res.code,200);assert.equal(res.data.userId,kept);
  const set=String(res.headers['Set-Cookie']);const tok=decodeURIComponent(set.match(/mimiobo_session=([^;]+)/)[1]);
  assert.equal(s.verify(tok,'session').userId,kept);
});
