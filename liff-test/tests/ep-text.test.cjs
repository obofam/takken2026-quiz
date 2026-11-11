'use strict';
// GET /api/ep-text: login + plan 'text' are decided on the server; the paid HTML is never in a public static file.
const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const s=require('../lib/server');
const textApi=require('../api/ep-text');
const karteApi=require('../api/karte');
const originalFetch=global.fetch,originalEnv={...process.env};
const user='12345678-1234-4123-8123-123456789abc';
const address='tester@example.com';
beforeEach(()=>{
  Object.assign(process.env,{SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'});
  delete process.env.ALLOW_TEXT_PREVIEW;
  global.fetch=async()=>{throw Error('unmocked fetch');};
});
after(()=>{global.fetch=originalFetch;process.env=originalEnv;});
function response(){const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
const cookie=()=>s.COOKIE+'='+s.sign({purpose:'session',userId:user,provider:'email',subject:address,exp:Date.now()/1000+600});
function request(query='ep=1',patch={},url='/api/ep-text'){return {method:'GET',url:url+'?'+query,headers:{host:'localhost:3000',cookie:cookie(),...patch}};}
function database({entitlements=[{plan:'text',valid_until:null}],log=[]}={}){
  global.fetch=async url=>{
    const u=new URL(url);log.push(u);let data;
    if(u.pathname==='/rest/v1/allowlist')data=[{provider:'email'}];
    else if(u.pathname==='/rest/v1/identities')data=[{user_id:user}];
    else if(u.pathname==='/rest/v1/entitlements')data=entitlements;
    else if(u.pathname==='/rest/v1/answers')data=[];
    else assert.fail('unexpected query '+u.pathname);
    return {ok:true,status:200,json:async()=>data};
  };
  return log;
}

test('not logged in: 401 and the text is not returned',async()=>{
  database();
  const res=response();await textApi(request('ep=1',{cookie:undefined}),res);
  assert.equal(res.code,401);assert.equal(res.data.error,'login_required');assert.equal(res.data.html,undefined);
});
test('logged in without the text plan: 403 text_not_entitled',async()=>{
  for(const entitlements of [[],[{plan:'ume',valid_until:null}],[{plan:'matsu',valid_until:null}]]){
    database({entitlements});
    const res=response();await textApi(request(),res);
    assert.equal(res.code,403);assert.deepEqual(res.data,{error:'text_not_entitled'});
  }
});
test('an expired text plan is not accepted',async()=>{
  database({entitlements:[{plan:'text',valid_until:'2000-01-01T00:00:00+00:00'}]});
  const res=response();await textApi(request(),res);
  assert.equal(res.code,403);assert.equal(res.data.error,'text_not_entitled');
});
test('with the text plan: 200 and {html} only, not cached',async()=>{
  const log=database();
  const res=response();await textApi(request(),res);
  assert.equal(res.code,200);assert.deepEqual(Object.keys(res.data),['html']);
  assert.match(res.data.html,/data-part="1"/);assert.match(res.data.html,/data-part="2"/);
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(log.find(u=>u.pathname==='/rest/v1/entitlements').searchParams.get('user_id'),'eq.'+user);
});
test('only ep=1 exists: other values are 404 (also without a login)',async()=>{
  database();
  for(const q of ['ep=2','ep=0','ep=','ep=1abc','ep=01x','']){
    const res=response();await textApi(request(q),res);
    assert.equal(res.code,404,q);assert.equal(res.data.html,undefined);
    const anon=response();await textApi(request(q,{cookie:undefined}),anon);assert.equal(anon.code,404,q);
  }
});
test('only GET is allowed',async()=>{
  database();
  const res=response();await textApi({...request(),method:'POST'},res);assert.equal(res.code,405);
});
test('mihon=1 is disabled without ALLOW_TEXT_PREVIEW (normal login check applies)',async()=>{
  database();
  const res=response();await textApi(request('ep=1&mihon=1',{cookie:undefined}),res);
  assert.equal(res.code,401);assert.equal(res.data.html,undefined);
  process.env.ALLOW_TEXT_PREVIEW='0';
  const other=response();await textApi(request('ep=1&mihon=1',{cookie:undefined}),other);assert.equal(other.code,401);
  process.env.ALLOW_TEXT_PREVIEW='true';
  const third=response();await textApi(request('ep=1&mihon=1',{cookie:undefined}),third);assert.equal(third.code,401);
});
test('mihon=1 with ALLOW_TEXT_PREVIEW=1 returns the text without a login; without mihon=1 the check still applies',async()=>{
  process.env.ALLOW_TEXT_PREVIEW='1';
  const res=response();await textApi(request('ep=1&mihon=1',{cookie:undefined}),res);
  assert.equal(res.code,200);assert.match(res.data.html,/data-part="1"/);
  const plain=response();await textApi(request('ep=1',{cookie:undefined}),plain);assert.equal(plain.code,401);
  const bad=response();await textApi(request('ep=2&mihon=1',{cookie:undefined}),bad);assert.equal(bad.code,404);
});
test('a user with only the text plan cannot read the karte (and the answers table is not read)',async()=>{
  const log=database();
  const res=response();await karteApi({method:'GET',url:'/api/karte',headers:{host:'localhost:3000',cookie:cookie()}},res);
  assert.equal(res.code,403);assert.deepEqual(res.data,{error:'karte_not_entitled'});
  assert.equal(log.some(u=>u.pathname==='/rest/v1/answers'),false);
  const both=database({entitlements:[{plan:'text',valid_until:null},{plan:'take',valid_until:null}]});
  const ok=response();await karteApi({method:'GET',url:'/api/karte',headers:{host:'localhost:3000',cookie:cookie()}},ok);
  assert.equal(ok.code,200);assert.ok(both.some(u=>u.pathname==='/rest/v1/answers'));
});
test('the paid text lives only under api/_ep-text, and no public file contains it',()=>{
  const root=path.join(__dirname,'..');
  const marker='役所が変わるときは';
  assert.ok(require('../api/_ep-text/ep1').includes(marker));
  const skip=new Set(['node_modules','.git','.vercel','api','tests','scripts','supabase','content']);
  const hits=[];
  (function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){
    if(skip.has(f.name))continue;
    const p=path.join(dir,f.name);
    if(f.isDirectory())walk(p);else if(/\.(html|js|json|css|svg)$/.test(f.name)&&fs.readFileSync(p,'utf8').includes('役所が変わるときは'))hits.push(p);
  }})(root);
  assert.deepEqual(hits,[]);
});
test('the 3-step page has no arrows, no emoji, no name, and the sample frame can be switched off',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../ep1-3dan.html'),'utf8');
  assert.doesNotMatch(html,/[→←↑↓]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.match(html,/mihon_text/);assert.match(html,/id="tsample"[\s\S]{0,600}takken\.mimiobo\.com\/ep\/1\/text/);assert.match(html,/mihon=1/);
  assert.doesNotMatch(html,/narabi|まとめて解く/);
});
