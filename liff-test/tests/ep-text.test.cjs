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
  const marker='なぜ、駆け込み廃業も取消しと同じ扱いなの';
  assert.ok(require('../api/_ep-text/ep1').includes(marker));
  const skip=new Set(['node_modules','.git','.vercel','api','tests','scripts','supabase','content']);
  const hits=[];
  (function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){
    if(skip.has(f.name))continue;
    const p=path.join(dir,f.name);
    if(f.isDirectory())walk(p);else if(/\.(html|js|json|css|svg)$/.test(f.name)&&fs.readFileSync(p,'utf8').includes('なぜ、駆け込み廃業も取消しと同じ扱いなの'))hits.push(p);
  }})(root);
  assert.deepEqual(hits,[]);
});
test('the 3-step page has no arrows, no emoji, no name, and the sample frame can be switched off',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../ep1-3dan.html'),'utf8');
  assert.doesNotMatch(html,/[→←↑↓]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.match(html,/mihon_text/);assert.match(html,/id="tsample"[\s\S]{0,600}takken\.mimiobo\.com\/ep\/1\/text/);assert.match(html,/mihon=1/);
  assert.doesNotMatch(html,/narabi|まとめて解く/);
});
test('the free excerpt (ep1-nukigaki.html): figures 1,3,5,6,8 only, no red-sheet marks, nothing paid-only',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../ep1-nukigaki.html'),'utf8');
  assert.deepEqual([...html.matchAll(/data-fig="(\d+)"/g)].map(m=>Number(m[1])),[1,3,5,6,8]);
  assert.deepEqual([...html.matchAll(/class="cap"><span class="n">(\d+)</g)].map(m=>Number(m[1])),[1,3,5,6,8]);
  assert.deepEqual([...html.matchAll(/<span class="gno">(\d+)</g)].map(m=>Number(m[1])),[2,4,7]);
  assert.equal([...html.matchAll(/class="gcard" href="https:\/\/takken\.mimiobo\.com\/ep\/1\/text"/g)].length,3);
  assert.doesNotMatch(html,/class="[^"]*\brs\b[^"]*"|role="button"|class="mk"|class="aside"|<use /);
  assert.doesNotMatch(html,/[→←↑↓]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  for(const w of ['転貸','又貸し','適用されない','事務所に数える','継続して業務ができる施設','取消しの理由','聴聞の公示','ワンポイント','駆け込み廃業も取消し'])
    assert.ok(!html.includes(w),w);
  // the free excerpt is a subset of the paid text (same words)
  const paid=require('../api/_ep-text/ep1');
  const strip=h=>h.replace(/<[^>]+>/g,'').replace(/\s+/g,'');
  for(const f of html.match(/<figure class="fig">[\s\S]*?<\/figure>/g))assert.ok(strip(paid).includes(strip(f)));
});
test('the 3-step page: no picture-illustration cards or img/*.webp for figures; excerpt is loaded',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../ep1-3dan.html'),'utf8');
  assert.doesNotMatch(html,/ep\/1\/img\/(?!artwork2027)/);
  assert.doesNotMatch(html,/class="card t-/);
  assert.match(html,/ep1-nukigaki\.html/);assert.match(html,/id="slot-fig1"/);
  assert.match(html,/class="tcard" id="tsample"[\s\S]{0,300}有料版の見本[\s\S]{0,700}見本を見る/);
  assert.doesNotMatch(html,/ul class="past txt/);assert.match(html,/学習ロードマップ・進捗トラッカー[\s\S]{0,80}全41回の予定を見る・聴いた回を記録する/);
  assert.doesNotMatch(html,/s-hint|ヒント。/);assert.match(html,/かける[\s\S]{0,200}はずす/);assert.match(html,/かくれている/);
  assert.doesNotMatch(html,/△|doubt|takken2027-sheet|△だけ/);assert.match(html,/もう一度押すと、またかくれます。/);
  // ヒントの規則（ページ内の hintOf を取り出して確かめる）
  const src=html.match(/function hintOf\(text\) \{[\s\S]*?\n  \}\n/)[0];
  const hintOf=new Function(src+'return hintOf;')();
  assert.equal(hintOf('5年'),'\u25CB年');assert.equal(hintOf('免許がいる'),'免\u25CB\u25CB\u25CB\u25CB');
  assert.equal(hintOf('1人でも欠格'),'\u25CB人でも欠格');assert.equal(hintOf('届出の日から5年'),'届出の日から\u25CB年');
  assert.equal(hintOf('背'),'\u25CB');assert.equal(hintOf('知事'),'知\u25CB');assert.equal(hintOf('復権の日から、すぐ'),'復\u25CB\u25CB\u25CB\u25CB○、\u25CB\u25CB');
});

// ---- GET /api/ep-pdf（印刷用A4版）：判定は ep-text と同じ。PDFの実体が無い環境でも通るよう読み込みを差し替える ----
const pdfApi=require('../api/ep-pdf');
function pdfResponse(){const r=response();r.body=null;r.send=function(b){this.body=b;return this;};return r;}
test('ep-pdf: 401 / 403 / 404 / 405, and the file is never read before the check passes',async()=>{
  database();
  const calls=[];const orig=pdfApi.source.read;pdfApi.source.read=ep=>{calls.push(ep);return Buffer.from('%PDF-test');};
  try{
    const a=pdfResponse();await pdfApi(request('ep=1',{cookie:undefined},'/api/ep-pdf'),a);assert.equal(a.code,401);assert.equal(a.body,null);
    database({entitlements:[{plan:'ume',valid_until:null}]});
    const b=pdfResponse();await pdfApi(request('ep=1',{},'/api/ep-pdf'),b);assert.equal(b.code,403);assert.deepEqual(b.data,{error:'text_not_entitled'});
    database();
    for(const q of ['ep=2','ep=0','ep=','ep=1abc']){const c=pdfResponse();await pdfApi(request(q,{},'/api/ep-pdf'),c);assert.equal(c.code,404,q);}
    const d=pdfResponse();await pdfApi({...request('ep=1',{},'/api/ep-pdf'),method:'POST'},d);assert.equal(d.code,405);
    assert.deepEqual(calls,[]);
  }finally{pdfApi.source.read=orig;}
});
test('ep-pdf: text / zenbu / bansou get 200 application/pdf (inline, UTF-8 filename, no-store)',async()=>{
  const orig=pdfApi.source.read;pdfApi.source.read=()=>Buffer.from('%PDF-test');
  try{
    for(const plan of ['text','zenbu','bansou']){
      database({entitlements:[{plan,valid_until:null}]});
      const res=pdfResponse();await pdfApi(request('ep=1',{},'/api/ep-pdf'),res);
      assert.equal(res.code,200,plan);assert.equal(res.headers['Content-Type'],'application/pdf');
      assert.equal(res.headers['Content-Disposition'],"inline; filename*=UTF-8''"+encodeURIComponent('やさしいテキスト_第1回_宅建業と免許.pdf'));
      assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(String(res.body),'%PDF-test');
    }
  }finally{pdfApi.source.read=orig;}
});
test('ep-pdf: mihon=1 works without a login only when ALLOW_TEXT_PREVIEW=1',async()=>{
  const orig=pdfApi.source.read;pdfApi.source.read=()=>Buffer.from('%PDF-test');
  try{
    database();
    for(const v of [undefined,'0','true']){
      if(v===undefined)delete process.env.ALLOW_TEXT_PREVIEW;else process.env.ALLOW_TEXT_PREVIEW=v;
      const r=pdfResponse();await pdfApi(request('ep=1&mihon=1',{cookie:undefined},'/api/ep-pdf'),r);assert.equal(r.code,401,String(v));assert.equal(r.body,null);
    }
    process.env.ALLOW_TEXT_PREVIEW='1';
    const ok=pdfResponse();await pdfApi(request('ep=1&mihon=1',{cookie:undefined},'/api/ep-pdf'),ok);assert.equal(ok.code,200);
    const plain=pdfResponse();await pdfApi(request('ep=1',{cookie:undefined},'/api/ep-pdf'),plain);assert.equal(plain.code,401);
    const bad=pdfResponse();await pdfApi(request('ep=2&mihon=1',{cookie:undefined},'/api/ep-pdf'),bad);assert.equal(bad.code,404);
  }finally{pdfApi.source.read=orig;}
});
test('ep-pdf: the PDF lives only under api/_ep-text (git-ignored), and vercel.json ships it with the function',()=>{
  const root=path.join(__dirname,'..');
  const v=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.deepEqual(v.functions['api/ep-pdf.js'],{includeFiles:'api/_ep-text/ep1.pdf'});
  assert.ok(v.headers&&v.regions&&v.crons);
  assert.match(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),/^api\/_ep-text\/$/m);
  assert.match(fs.readFileSync(path.join(root,'scripts/build-ep1-text.mjs'),'utf8'),/ep1\.pdf/);
});
