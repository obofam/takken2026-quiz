'use strict';
// GET /api/karte: login + entitlement are decided on the server; only the caller's own answer rows come back.
const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const s=require('../lib/server');
const karteApi=require('../api/karte');
const originalFetch=global.fetch,originalEnv={...process.env};
const user='12345678-1234-4123-8123-123456789abc',other='87654321-1234-4123-8123-123456789abc';
const address='tester@example.com';
beforeEach(()=>{
  Object.assign(process.env,{SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'});
  global.fetch=async()=>{throw Error('unmocked fetch');};
});
after(()=>{global.fetch=originalFetch;process.env=originalEnv;});
function response(){const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
const cookie=(id=user)=>s.COOKIE+'='+s.sign({purpose:'session',userId:id,provider:'email',subject:address,exp:Date.now()/1000+600});
function request(patch={}){return {method:'GET',url:'/api/karte',headers:{host:'localhost:3000',cookie:cookie(),...patch}};}
const ROWS=[
  {user_id:user,quiz_id:'ep10',question_id:'ep10-money',value:true,answered_at:'2026-10-01T00:00:00+00:00',attempt_id:'aaaaaaaa-1234-4123-8123-123456789abc'},
  {user_id:user,quiz_id:'ep10',question_id:'ep10-join',value:null,answered_at:'2026-10-02T00:00:00+00:00',attempt_id:'aaaaaaaa-1234-4123-8123-123456789abc'},
  {user_id:other,quiz_id:'ep10',question_id:'ep10-add',value:false,answered_at:'2026-10-03T00:00:00+00:00',attempt_id:'bbbbbbbb-1234-4123-8123-123456789abc'}
];
// PostgREST filters by user_id; the fake does the same so a missing filter would show up as another user's row.
function database({entitlements=[{plan:'ume',valid_until:'2999-01-01T00:00:00+00:00'}],log=[],rows=ROWS}={}){
  global.fetch=async(url,options)=>{
    const u=new URL(url);log.push(u);let data;
    if(u.pathname==='/rest/v1/allowlist')data=[{provider:'email'}];
    else if(u.pathname==='/rest/v1/identities')data=[{user_id:user}];
    else if(u.pathname==='/rest/v1/entitlements')data=entitlements;
    else if(u.pathname==='/rest/v1/answers'){const who=u.searchParams.get('user_id').replace(/^eq\./,'');data=rows.filter(r=>r.user_id===who);}
    else assert.fail('unexpected query '+u.pathname);
    return {ok:true,status:200,json:async()=>data};
  };
  return log;
}

test('not logged in: 401 and nothing is read',async()=>{
  database();
  const res=response();await karteApi(request({cookie:undefined}),res);
  assert.equal(res.code,401);assert.equal(res.data.error,'login_required');
});
test('a different user header than the session: 401 user_changed',async()=>{
  database();
  const res=response();await karteApi(request({'x-mimiobo-user':other}),res);
  assert.equal(res.code,401);assert.equal(res.data.error,'user_changed');assert.equal(res.data.rows,undefined);
});
test('only GET is allowed',async()=>{
  database();
  const res=response();await karteApi({...request(),method:'POST'},res);assert.equal(res.code,405);
});
test('no entitlement: 403 karte_not_entitled and the answers table is never read',async()=>{
  const log=database({entitlements:[]});
  const res=response();await karteApi(request(),res);
  assert.equal(res.code,403);assert.deepEqual(res.data,{error:'karte_not_entitled'});
  assert.equal(log.some(u=>u.pathname==='/rest/v1/answers'),false);
});
test('an expired entitlement is not accepted (the entitlement query only asks for live rows, and stale rows are filtered again)',async()=>{
  const log=database({entitlements:[{plan:'ume',valid_until:'2000-01-01T00:00:00+00:00'},{plan:'karte',valid_until:null}]});
  const res=response();await karteApi(request(),res);
  assert.equal(res.code,403);assert.equal(res.data.error,'karte_not_entitled');
  const q=log.find(u=>u.pathname==='/rest/v1/entitlements');
  assert.equal(q.searchParams.get('user_id'),'eq.'+user);assert.match(q.searchParams.get('or'),/valid_until\.gt\./);
  assert.equal(log.some(u=>u.pathname==='/rest/v1/answers'),false);
});
test('with ume (or take / matsu): 200 with only the caller\'s own rows and no user_id in the response',async()=>{
  for(const plan of ['ume','take','matsu']){
    const log=database({entitlements:[{plan,valid_until:null}]});
    const res=response();await karteApi(request(),res);
    assert.equal(res.code,200,plan);
    assert.deepEqual(res.data,{rows:[
      {quiz_id:'ep10',question_id:'ep10-money',value:true,answered_at:'2026-10-01T00:00:00+00:00',attempt_id:'aaaaaaaa-1234-4123-8123-123456789abc'},
      {quiz_id:'ep10',question_id:'ep10-join',value:null,answered_at:'2026-10-02T00:00:00+00:00',attempt_id:'aaaaaaaa-1234-4123-8123-123456789abc'}
    ]},plan);
    assert.doesNotMatch(JSON.stringify(res.data),new RegExp(other+'|user_id'));
    const q=log.find(u=>u.pathname==='/rest/v1/answers');
    assert.equal(q.searchParams.get('user_id'),'eq.'+user);
    assert.equal(q.searchParams.get('select'),'quiz_id,question_id,value,answered_at,attempt_id');
    assert.equal(q.searchParams.get('order'),'answered_at.asc');assert.equal(q.searchParams.get('limit'),'5000');
  }
});
test('a user with an entitlement and no answers gets an empty list',async()=>{
  database({rows:[]});
  const res=response();await karteApi(request(),res);
  assert.equal(res.code,200);assert.deepEqual(res.data,{rows:[]});
});
test('a database failure is a generic 503',async()=>{
  global.fetch=async url=>{const u=new URL(url);
    if(u.pathname==='/rest/v1/answers')return {ok:false,status:500,json:async()=>({message:'private'})};
    return {ok:true,status:200,json:async()=>u.pathname==='/rest/v1/allowlist'?[{provider:'email'}]:u.pathname==='/rest/v1/identities'?[{user_id:user}]:[{plan:'ume',valid_until:null}]};};
  const res=response();await karteApi(request(),res);
  assert.equal(res.code,503);assert.deepEqual(res.data,{error:'database_unavailable'});
});
test('the response is not cached and the local dev harness exposes the endpoint and the two shared scripts',()=>{
  database();
  const res=response();return karteApi(request(),res).then(()=>{
    assert.equal(res.headers['Cache-Control'],'no-store');
    const dev=require('node:fs').readFileSync(require('node:path').join(__dirname,'../scripts/dev.cjs'),'utf8');
    assert.match(dev,/'quiz-catalog\.js'/);assert.match(dev,/'karte-core\.js'/);assert.match(dev,/'stripe-webhook','karte'/);
  });
});
