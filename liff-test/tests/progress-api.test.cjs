'use strict';
// /api/progress：ログイン必須・1件の変更・合わせ込み（merge）。データベースは fetch の差し替えで再現する（検査の本体は progress-db.test.cjs）。
const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const s=require('../lib/server');
const progressApi=require('../api/progress');
const productsApi=require('../api/products');
const originalFetch=global.fetch,originalEnv={...process.env};
const user='12345678-1234-4123-8123-123456789abc',other='87654321-1234-4123-8123-123456789abc';
beforeEach(()=>{
  Object.assign(process.env,{SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'});
  global.fetch=async()=>{throw Error('unmocked fetch');};
});
after(()=>{global.fetch=originalFetch;process.env=originalEnv;});
function response(){const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
const cookie=(id=user)=>s.COOKIE+'='+s.sign({purpose:'session',userId:id,provider:'email',subject:'tester@example.com',exp:Date.now()/1000+600});
const get=(patch={})=>({method:'GET',url:'/api/progress',headers:{host:'localhost:3000',cookie:cookie(),...patch}});
const post=(body,patch={})=>({method:'POST',url:'/api/progress',body,headers:{host:'localhost:3000',cookie:cookie(),origin:'http://localhost:3000','content-type':'application/json',...patch}});
const okValue=(kind,v)=>(kind==='listened'||kind==='kako')?(v===1||v===2):kind==='done'?v===true:false;
// 表と同じ規則の最小の再現：サーバーにあるキーは merge で残す、null は消す、検査に落ちたら invalid_progress（400相当）。
function database({rows={},allowed=true,noKakoColumn=false}={}){
  const log=[];
  global.fetch=async(url,options={})=>{
    const u=new URL(url),body=options.body?JSON.parse(options.body):undefined;log.push({path:u.pathname,body});
    const reply=(data,status=200)=>({ok:status<400,status,json:async()=>data});
    if(u.pathname==='/rest/v1/allowlist')return reply(allowed?[{provider:'email'}]:[]);
    if(u.pathname==='/rest/v1/identities')return reply([{user_id:user}]);
    if(u.pathname==='/rest/v1/progress'){
      // kako の列が無い表（migration の適用前）は、kako を選ぶと 400 になる
      if(noKakoColumn&&u.searchParams.get('select').includes('kako'))return reply({message:'column progress.kako does not exist',code:'42703'},400);
      const who=u.searchParams.get('user_id').replace(/^eq\./,'');return reply(rows[who]?[rows[who]]:[]);}
    const row=()=>rows[body.p_user_id]??={listened:{},done:{},kako:{},updated_at:'2026-11-13T00:00:00+00:00'};
    const bad=()=>reply({message:'invalid_progress',code:'22023'},400);
    if(u.pathname==='/rest/v1/rpc/set_progress'){
      if(!['listened','done','kako'].includes(body.p_kind)||!/^[A-Za-z0-9-]{1,40}$/.test(body.p_key)||(body.p_value!==null&&!okValue(body.p_kind,body.p_value)))return bad();
      const r=row();r.kako??={};if(body.p_value===null)delete r[body.p_kind][body.p_key];else r[body.p_kind][body.p_key]=body.p_value;return reply(r);
    }
    if(u.pathname==='/rest/v1/rpc/merge_progress'){
      for(const [k,m] of [['listened',body.p_listened],['done',body.p_done],['kako',body.p_kako??{}]])for(const [key,v] of Object.entries(m))if(!/^[A-Za-z0-9-]{1,40}$/.test(key)||!okValue(k,v))return bad();
      const r=row();r.kako??={};r.listened={...body.p_listened,...r.listened};r.done={...body.p_done,...r.done};r.kako={...(body.p_kako??{}),...r.kako};return reply(r);
    }
    if(u.pathname==='/rest/v1/users')return reply([{id:user}]);
    assert.fail('unexpected query '+u.pathname);
  };
  return {log,rows};
}

test('not logged in: 401 for GET and POST, and the progress table is not touched',async()=>{
  const db=database();
  let res=response();await progressApi(get({cookie:undefined}),res);assert.equal(res.code,401);assert.equal(res.data.error,'login_required');
  res=response();await progressApi(post({kind:'listened',key:'1',value:1},{cookie:undefined}),res);assert.equal(res.code,401);
  assert.equal(db.log.some(l=>l.path.includes('progress')),false);
});
test('a user who is not on the allowlist gets 403',async()=>{
  database({allowed:false});
  const res=response();await progressApi(get(),res);assert.equal(res.code,403);assert.equal(res.data.error,'not_allowed');
});
test('GET with no row returns empty maps; only the session user is read',async()=>{
  const db=database({rows:{[other]:{listened:{'9':1},done:{},updated_at:'x'}}});
  const res=response();await progressApi(get(),res);
  assert.equal(res.code,200);assert.deepEqual(res.data,{listened:{},done:{},kako:{},updatedAt:null});
  assert.ok(db.log.find(l=>l.path==='/rest/v1/progress'));
});
test('GET returns the stored maps and updatedAt',async()=>{
  database({rows:{[user]:{listened:{'1':2},done:{'1':true},updated_at:'2026-11-13T01:02:03+00:00'}}});
  const res=response();await progressApi(get(),res);
  assert.deepEqual(res.data,{listened:{'1':2},done:{'1':true},kako:{},updatedAt:'2026-11-13T01:02:03+00:00'});
});
test('POST one change: set, then null removes; the user comes from the session, not the body',async()=>{
  const db=database();
  let res=response();await progressApi(post({kind:'listened',key:'3',value:2,userId:other}),res);
  assert.equal(res.code,200);assert.deepEqual(res.data.listened,{'3':2});assert.deepEqual(res.data.done,{});
  assert.equal(db.log.find(l=>l.path==='/rest/v1/rpc/set_progress').body.p_user_id,user);
  res=response();await progressApi(post({kind:'done',key:'3',value:true}),res);assert.deepEqual(res.data.done,{'3':true});
  res=response();await progressApi(post({kind:'listened',key:'3',value:null}),res);assert.equal(res.code,200);assert.deepEqual(res.data.listened,{});assert.deepEqual(res.data.done,{'3':true});
});
test('POST with a bad value, key, kind or shape: 400 invalid_progress',async()=>{
  database();
  for(const body of [{kind:'listened',key:'1',value:3},{kind:'done',key:'1',value:1},{kind:'listened',key:'a b',value:1},{kind:'nope',key:'1',value:1},{kind:'listened',key:'1'},{key:'1',value:1},{merge:true,listened:[1],done:{}},{merge:true,listened:{},done:'x'},{merge:true,listened:{'1':9},done:{}}]){
    const res=response();await progressApi(post(body),res);
    assert.equal(res.code,400,JSON.stringify(body));assert.equal(res.data.error,'invalid_progress');
  }
});
test('POST needs a same-origin JSON request',async()=>{
  database();
  let res=response();await progressApi(post({kind:'listened',key:'1',value:1},{origin:'https://evil.example'}),res);assert.equal(res.code,403);
  res=response();await progressApi(post({kind:'listened',key:'1',value:1},{'content-type':'text/plain'}),res);assert.equal(res.code,415);
});
test('merge does not overwrite keys the server already has',async()=>{
  database({rows:{[user]:{listened:{'1':2},done:{'1':true},updated_at:'x'}}});
  const res=response();await progressApi(post({merge:true,listened:{'1':1,'2':1},done:{'2':true}}),res);
  assert.equal(res.code,200);assert.deepEqual(res.data.listened,{'1':2,'2':1});assert.deepEqual(res.data.done,{'1':true,'2':true});
});
test('kako: GET returns it; POST {kind:kako} sets 1 or 2, null removes, other values are 400',async()=>{
  const db=database({rows:{[user]:{listened:{},done:{},kako:{'1':2},updated_at:'x'}}});
  let res=response();await progressApi(get(),res);assert.deepEqual(res.data.kako,{'1':2});
  res=response();await progressApi(post({kind:'kako',key:'1',value:1}),res);assert.equal(res.code,200);assert.deepEqual(res.data.kako,{'1':1});
  assert.equal(db.log.find(l=>l.path==='/rest/v1/rpc/set_progress').body.p_kind,'kako');
  res=response();await progressApi(post({kind:'kako',key:'1',value:null}),res);assert.deepEqual(res.data.kako,{});
  for(const v of [0,3,true,'1']){res=response();await progressApi(post({kind:'kako',key:'1',value:v}),res);assert.equal(res.code,400,String(v));}
});
test('kako: merge adds only keys the server lacks; no kako (an old screen) still works and sends no p_kako; a bad kako is 400',async()=>{
  const db=database({rows:{[user]:{listened:{},done:{},kako:{'1':2},updated_at:'x'}}});
  let res=response();await progressApi(post({merge:true,listened:{},done:{},kako:{'1':1,'2':1}}),res);
  assert.equal(res.code,200);assert.deepEqual(res.data.kako,{'1':2,'2':1});
  assert.deepEqual(db.log.find(l=>l.path==='/rest/v1/rpc/merge_progress').body.p_kako,{'1':1,'2':1});
  res=response();await progressApi(post({merge:true,listened:{'3':1},done:{}}),res);
  assert.equal(res.code,200);assert.deepEqual(res.data.listened,{'3':1});
  assert.equal('p_kako' in db.log.filter(l=>l.path==='/rest/v1/rpc/merge_progress')[1].body,false);
  for(const kako of [[1],'x',{'1':3},{'a b':1}]){res=response();await progressApi(post({merge:true,listened:{},done:{},kako}),res);assert.equal(res.code,400,JSON.stringify(kako));}
});
test('before migration 202611130004: GET still works (reads without the kako column and returns kako as empty)',async()=>{
  const db=database({noKakoColumn:true,rows:{[user]:{listened:{'1':1},done:{},updated_at:'x'}}});
  const res=response();await progressApi(get(),res);
  assert.equal(res.code,200);assert.deepEqual(res.data,{listened:{'1':1},done:{},kako:{},updatedAt:'x'});
  assert.equal(db.log.filter(l=>l.path==='/rest/v1/progress').length,2);
});
test('other methods: 405',async()=>{
  database();
  const res=response();await progressApi({...get(),method:'DELETE'},res);assert.equal(res.code,405);
});

test('keepalive moved to /api/products?keepalive=1 (reads one row, returns only ok); the plain call is unchanged',async()=>{
  const db=database();
  let res=response();await productsApi({method:'GET',url:'/api/products?keepalive=1',query:{keepalive:'1'},headers:{host:'localhost:3000'}},res);
  assert.deepEqual(res.data,{ok:true});assert.equal(db.log.length,1);assert.equal(db.log[0].path,'/rest/v1/users');
  res=response();await productsApi({method:'GET',url:'/api/products',query:{},headers:{host:'localhost:3000'}},res);
  assert.ok(Array.isArray(res.data.products));assert.equal(db.log.length,1);
});
test('vercel.json cron calls /api/products?keepalive=1 and api/keepalive.js is gone',()=>{
  const root=path.join(__dirname,'..');
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.deepEqual(cfg.crons.map(c=>c.path),['/api/products?keepalive=1']);
  assert.equal(fs.existsSync(path.join(root,'api/keepalive.js')),false);
});
test('Vercel free plan: at most 12 functions directly under api/ (folders starting with _ are not functions)',()=>{
  const dir=path.join(__dirname,'../api');
  const functions=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.js')&&!e.name.startsWith('_'));
  assert.ok(functions.length<=12,'api/ has '+functions.length+' functions');
  assert.ok(functions.some(e=>e.name==='progress.js'));
});
