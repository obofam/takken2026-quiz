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
test('only built episodes exist (api/_ep-text/ep<N>.js): other values are 404 (also without a login)',async()=>{
  database();
  for(const q of ['ep=10','ep=999','ep=0','ep=','ep=1abc','ep=01x','ep=../ep1','']){
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
  const bad=response();await textApi(request('ep=10&mihon=1',{cookie:undefined}),bad);assert.equal(bad.code,404);
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
test('the free excerpt (ep/1/tsuzuki.html): figures 1,3,5,6,8 only, no red-sheet marks, nothing paid-only',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../ep/1/tsuzuki.html'),'utf8');
  assert.deepEqual([...html.matchAll(/data-fig="(\d+)"/g)].map(m=>Number(m[1])),[1,3,5,6,8]);
  assert.deepEqual([...html.matchAll(/class="cap"><span class="n">(\d+)</g)].map(m=>Number(m[1])),[1,3,5,6,8]);
  assert.deepEqual([...html.matchAll(/<span class="gno">(\d+)</g)].map(m=>Number(m[1])),[2,4,7]);
  assert.equal([...html.matchAll(/class="gcard"><span class="gno">\d+<\/span><span class="gm"><span class="gt">[^<]*<\/span><span class="gn">この図は、<a href="https:\/\/takken\.mimiobo\.com\/ep\/1\/text"/g)].length,3);
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
  assert.match(html,/ep\/1\/tsuzuki\.html/);assert.match(html,/id="slot-fig1"/);
  assert.match(html,/class="tcard" id="tsample"[\s\S]{0,300}有料版の見本[\s\S]{0,700}見本を見る/);
  assert.doesNotMatch(html,/ul class="past txt/);assert.match(html,/学習ロードマップ（兼 進捗トラッカー）[\s\S]{0,80}全41回の予定を見る・聴いた回を記録する/);
  assert.doesNotMatch(html,/s-hint|ヒント。/);assert.match(html,/role="switch" data-r="sw" aria-checked="true"/);assert.match(html,/かくれている/);
  assert.doesNotMatch(html,/△|doubt|takken2027-sheet|△だけ/);assert.match(html,/もう一度押すと、またかくれます。/);
  // ヒントの規則（build-ep1-text.mjs の表が決めた data-hint を、組み上がったテキストで確かめる）
  const built=require('../api/_ep-text/ep1');
  const got=[...built.matchAll(/class="([^"]*\brs\b[^"]*)" role="button" tabindex="0" data-hint="([^"]*)">([^<]*)</g)].map(m=>m[3]+'=>'+m[2]);
  const C='\u25CB';
  assert.deepEqual(got,[
    '免許がいる=>いる／いらない','知事=>知事／大臣','大臣=>知事／大臣','いらない=>いる／いらない','いらない=>いる／いらない','免許がいる=>いる／いらない',
    '当たらない=>当たる／当たらない','いらない=>いる／いらない','いらない=>いる／いらない','適用されない=>適用される／適用されない','事務所の場所=>事'+C.repeat(5),'免許換え=>免'+C.repeat(3),
    '5年=>'+C+'年','すぐ=>すぐ／5年','すぐ=>すぐ／5年','すぐ=>すぐ／5年','欠格になる罪=>欠'+C.repeat(5),'背任=>背'+C,'欠格にならない=>欠格になる／欠格にならない',
    '道路交通法=>道'+C.repeat(4),'控訴=>控'+C,'届出の日から5年=>届出の日から'+C+'年','1人でも欠格=>'+C+'人でも欠格','免許を受けられる=>受けられる／受けられない',
    '1つ=>'+C+'つ','2つ以上=>'+C+'つ以上','5年=>'+C+'年','90日前〜30日前=>'+C+'日前〜'+C+'日前','5年=>'+C+'年','60日以内=>'+C+'日以内']);
  // 6字を超える語は、核だけにかけ直してある（数字の語は前後の言葉を見せるので対象外）
  for(const m of built.matchAll(/class="[^"]*\brs\b[^"]*" role="button" tabindex="0" data-hint="[^"]*">([^<]*)</g)){
    if(!/[0-9]/.test(m[1])&&!/[／]/.test(m[0]))assert.ok(Array.from(m[1]).length<=6,m[1]);
  }
  assert.equal(got.length,30);
  // 今回の数字：有料の全文だけ。6組、今日のポイントの下・過去問1選の前（画面側）
  assert.match(built,/data-part="3"/);
  const nums=[...built.matchAll(/<span class="nv rs"[^>]*>([^<]*)<\/span><span class="nk">([^<]*)</g)].map(m=>m[1]+'|'+m[2]);
  assert.deepEqual(nums,['1つ|知事免許になる事務所の県数','2つ以上|大臣免許になる事務所の県数','5年|免許の有効期間','90日前〜30日前|更新の申請期間（満了日の）','5年|免許を受けられない期間','60日以内|聴聞の公示前に役員だった期間']);
  const nk=fs.readFileSync(path.join(__dirname,'../ep/1/tsuzuki.html'),'utf8');
  assert.ok(!nk.includes('今回の数字')&&!nk.includes('data-part="3"'));
  const pg=fs.readFileSync(path.join(__dirname,'../ep1-3dan.html'),'utf8');
  /* 数字の節は、赤シートの帯と同じ箱（tw）の中に入れる。外に置くと、そこまで下がった所で帯が消える */
  assert.match(pg,/tw\.appendChild\(sec3\)/);assert.doesNotMatch(pg,/insertBefore\(sec3, honban\)/);assert.match(pg,/setupSheet\(\[h1\.root, h2\.root, h3\.root\]/);
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
    for(const q of ['ep=10','ep=0','ep=','ep=1abc']){const c=pdfResponse();await pdfApi(request(q,{},'/api/ep-pdf'),c);assert.equal(c.code,404,q);}
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
    const bad=pdfResponse();await pdfApi(request('ep=10&mihon=1',{cookie:undefined},'/api/ep-pdf'),bad);assert.equal(bad.code,404);
  }finally{pdfApi.source.read=orig;}
});
test('ep-pdf: the PDF lives only under api/_ep-text (git-ignored), and vercel.json ships it with the function',()=>{
  const root=path.join(__dirname,'..');
  const v=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.deepEqual(v.functions['api/ep-pdf.js'],{includeFiles:'api/_ep-text/**'});assert.deepEqual(v.functions['api/ep-text.js'],{includeFiles:'api/_ep-text/**'});
  assert.ok(v.headers&&v.regions&&v.crons);
  assert.match(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),/^api\/_ep-text\/$/m);
  assert.match(fs.readFileSync(path.join(root,'scripts/build-ep.mjs'),'utf8'),/api\/_ep-text\/ep\$\{ep\}\.pdf/);
});

// ---- 本番（公開サイトの ep/1/）に置く LINE登録者向けの続き：無料の抜粋だけ。有料の中身を入れない ----
test('production ep/1: tsuzuki.html is the free excerpt (same as liff-test/ep/1/tsuzuki.html) and the LINE parts carry nothing paid',()=>{
  const prod=path.join(__dirname,'../../ep/1');
  const tz=fs.readFileSync(path.join(prod,'tsuzuki.html'),'utf8');
  assert.equal(tz,fs.readFileSync(path.join(__dirname,'../ep/1/tsuzuki.html'),'utf8'));
  const files=['tsuzuki.html','line-full.html','line-full.js','index.html'].map(f=>[f,fs.readFileSync(path.join(prod,f),'utf8')]);
  for(const [f,h] of files){
    assert.doesNotMatch(h,/class="[^"]*\brs\b[^"]*"|data-hint|data-part=|class="[^"]*(?:key|aside)/,f);
    if(f!=='index.html')assert.ok(!h.includes('今回の数字'),f);// index.html にあるのは見本カードの説明文「今回の数字」だけ（既存の文言）
    // 本番の第1回（index.html）だけは、購入の確認（GET /api/ep-text）を呼ぶ。テキストの中身はAPIが返すので、ここには無い
    assert.doesNotMatch(h,f==='index.html'?/_ep-text|api\/session/:/_ep-text|api\/ep-text|api\/session/,f);
    for(const w of ['転貸','又貸し','事務所に数える','継続して業務ができる施設','取消しの理由','聴聞の公示','駆け込み廃業も取消し'])assert.ok(!h.includes(w),f+':'+w);
  }
  const page=files.find(x=>x[0]==='index.html')[1];
  assert.match(page,/2012583516-7vmvMorb/);
  assert.doesNotMatch(page,/liff\.login\(|2011606963/);
  assert.match(page,/takken2027-done/);
  const top=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
  assert.match(top,/liff\.state/);assert.match(top,/2012583516-7vmvMorb/);
});

// ---- 見本ページ ep/1/text/index.html：有料の中身を公開側に出してよいのはここだけ。購入者の画面と同じ中身・赤シート30か所 ----
const sampleDir=path.join(__dirname,'../../ep/1/text');
const sample=()=>fs.readFileSync(path.join(sampleDir,'index.html'),'utf8');
const plainText=h=>h.replace(/<[^>]+>/g,'').replace(/\s+/g,'');
test('sample page (ep/1/text): the same text as the buyer screen, 30 red-sheet spots, nothing the paid text lacks',()=>{
  const html=sample(),built=require('../api/_ep-text/ep1');
  assert.equal((html.match(/class="[^"]*\brs\b/g)||[]).length,30);
  // 購入者の画面と同じ部品：前半・後半・今回の数字の中身と、CSSが、そのまま入っている
  for(const n of [1,2,3]){
    const from=built.indexOf('<div class="tx" data-part="'+n+'">'),next=built.indexOf('<div class="tx" data-part="'+(n+1)+'">');
    const part=next<0?built.slice(from):built.slice(from,next);
    assert.ok(html.includes(part),'part '+n);
  }
  assert.ok(html.includes(built.match(/^<style>[\s\S]*?<\/style>/)[0]),'css');
  // 赤シートの動きと帯・ヒントのCSSは、購入者の画面（ep1-3dan.html）と同じもの
  const dan=fs.readFileSync(path.join(__dirname,'../ep1-3dan.html'),'utf8');
  assert.ok(html.includes(dan.match(/  function esc\(s\)[\s\S]*?(?=\n  function showBuyer\(html\))/)[0]),'setupSheet');
  assert.ok(html.includes(dan.match(/\.sbar2\{[\s\S]*?\.sb2:focus-visible\{[^}]*\}/)[0]),'sheet css');
  assert.match(html,/赤シート<\/span><button type="button" class="sb2" role="switch" data-r="sw"[\s\S]{0,200}data-r="hid"/);
  assert.match(html,/赤い所を押すと答えが出ます。[\s\S]{0,60}もう一度押すと、またかくれます。/);
  // 並び：前半、後半、今日のポイント、今回の数字、過去問1選、PDF（3問は前半・後半の直後に script が移す）
  const order=['id="text1"','id="text2"','id="point"','id="numbers"','id="honban"','class="pdfbtn"'].map(k=>html.indexOf(k));
  assert.ok(order.every((v,i)=>v>0&&(i===0||v>order[i-1])),order.join());
  assert.equal((html.match(/<div class="core"><h2>今日のポイント<\/h2>/g)||[]).length,2);
  // △は無い・API は呼ばない・絵の版の部品は無い
  assert.doesNotMatch(html,/△|doubt|s-flag|s-hint|takken2027-sheet/);
  assert.doesNotMatch(html,/fetch\(|api\/ep-text|api\/session|_ep-text/);
  assert.doesNotMatch(html,/class="mk"|class="rvq"|rvData|id="sbDoubt"|放送の寄り道から」|罰金で欠格になるのは|復習の1問|\/ep\/1\/img\//);
  assert.doesNotMatch(html,/[→←↑↓]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});
test('sample page (ep/1/text): wording rules - no 寄り道 as a selling point, no price, 登録無料です。, 準備中 stays',()=>{
  const html=sample();
  // 「寄り道」は、中身の中の囲みの見出しにだけ出る
  const shown=html.replace(/<style>[\s\S]*?<\/style>/g,'').replace(/<!--[\s\S]*?-->/g,'');// 見えない部分（CSSの注釈）は数えない
  assert.equal((shown.match(/寄り道/g)||[]).length,0);// 2026-11-14 材料の札の文言が「このルールができたわけ」に変わった
  assert.equal((html.match(/このルールができたわけ/g)||[]).length,0);// 2026-11-15 札の字は「ルールのわけ」に（Kei）
  assert.equal((html.match(/ルールのわけ/g)||[]).length,1);
  assert.doesNotMatch(html,/[0-9０-９,，]+\s*円|[¥￥]|税込|値段|価格|料金/);
  assert.doesNotMatch(html,/登録は無料です/);
  assert.match(html,/登録無料です。/);
  assert.match(html,/有料版の見本/);assert.match(html,/やさしいテキスト　第1回　<span class="nb">宅建業と免許<\/span><\/h1>/);
  assert.match(html,/これを見ながら放送を聴くと、より理解が深まるように作っています。無料の図解は、このテキストからの抜粋です。/);
  assert.match(html,/このテキストは準備中です。第1回を、見本として公開しています。/);
  assert.match(html,/テキスト<\/span><small><span class="nb">有料・<\/span><span class="nb">準備中/);
  // 検索に出さない・計測は残す（名前は今までどおり）
  assert.match(html,/<meta name="robots" content="noindex, nofollow">/);
  assert.match(html,/<title>やさしいテキスト 第1回（見本）｜耳で覚える宅建2027<\/title>/);
  assert.match(html,/cloud\.umami\.is\/script\.js" data-website-id="99a5370c-5fbd-4ceb-9d35-7734d7c580ec"/);
  assert.match(html,/href="\/ep\/1\/text\/yasashii-text-01-a4\.pdf"[^>]*data-umami-event="text-a4-pdf" data-umami-event-ep="1">印刷用のA4版（PDF）を開く/);
  assert.match(html,/href="\/roadmap"[^>]*data-umami-event="text-back" data-umami-event-to="roadmap">学習ロードマップ（兼 進捗トラッカー）へ/);
  assert.match(html,/data-umami-event="text-line" data-umami-event-ep="1">LINEで受け取る/);
  assert.match(html,/mimiobo\.substack\.com\/subscribe" target="_blank" rel="noopener" data-umami-event="text-mail" data-umami-event-ep="1">メールで受け取る/);
  assert.ok(fs.existsSync(path.join(sampleDir,'yasashii-text-01-a4.pdf')));
});
test('sample page (ep/1/text): the table has the 7 rows and the same marks as roadmap; the LINE/mail box has the same words',()=>{
  const html=sample(),road=fs.readFileSync(path.join(__dirname,'../../roadmap/index.html'),'utf8');
  const table=h=>h.match(/<section class="tiers"[\s\S]*?<\/section>/)[0].replace(/\s*<p class="tt-note">[\s\S]*?<\/p>/,'');
  assert.equal(table(html),table(road));
  const body=table(html).match(/<tbody>[\s\S]*<\/tbody>/)[0];
  const rows=[...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m=>m[1]);
  assert.deepEqual(rows.map(r=>plainText(r.match(/<th>([\s\S]*?)<\/th>/)[1])),['図解','○×3問','過去問1選','ひっかけあるある','覚える数字まとめ','赤シート','印刷用のA4版']);
  assert.deepEqual(rows.map(r=>[...r.matchAll(/<td class="([yn])">/g)].map(m=>m[1]).join('')),['','yyy','nyy','nny','nny','nny','nny']);
  assert.deepEqual(plainText(rows[0]).replace(/^図解/,''),'最初の1枚続きまで全部');
  assert.doesNotMatch(table(html),/復習|使い方|寄り道/);
  assert.match(plainText(table(html).match(/<thead>[\s\S]*?<\/thead>/)[0]),/^登録なしLINE・メール登録・無料やさしいテキスト有料・準備中$/);
  const cta=h=>h.match(/<section class="line-cta">[\s\S]*?<\/section>/)[0];
  const w=h=>plainText(cta(h).replace(/ data-umami[^>]*/g,''));
  assert.equal(w(html),w(road));
  assert.deepEqual([...cta(html).matchAll(/class="btn" href="([^"]+)"/g)].map(m=>m[1]),[...cta(road).matchAll(/class="btn" href="([^"]+)"/g)].map(m=>m[1]));
  assert.match(html,/t < 20270104[\s\S]{0,400}始まったら、[\s\S]{0,200}LINEかメールでお知らせします[\s\S]{0,300}毎週月曜にお届けします（予定）。[\s\S]{0,100}登録無料です。/);
});
test('the paid text is public only in ep/1/text/: no other public file carries it, and the other 4 ep/1 files stay clean',()=>{
  const prod=path.join(__dirname,'../..');
  const skip=new Set(['node_modules','.git','.vercel','api','liff-test','scripts','__pycache__']);
  const marker='なぜ、駆け込み廃業も取消しと同じ扱いなの';
  const hits=[];
  (function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){
    if(skip.has(f.name))continue;
    const p=path.join(dir,f.name);
    if(f.isDirectory())walk(p);else if(/\.(html|js|json|css|svg|md|txt)$/.test(f.name)&&fs.readFileSync(p,'utf8').includes(marker))hits.push(path.relative(prod,p).split(path.sep).join('/'));
  }})(prod);
  assert.deepEqual(hits,['ep/1/text/index.html']);
  for(const f of ['index.html','tsuzuki.html','line-full.html','line-full.js']){
    const h=fs.readFileSync(path.join(prod,'ep/1',f),'utf8');
    assert.doesNotMatch(h,/class="[^"]*\brs\b[^"]*"|data-hint|data-part=|class="[^"]*(?:key|aside)|setupSheet|tpl-css/,f);
    assert.ok(!h.includes(marker),f);
  }
});

// ---- 本番の購入者の見え方：ep/1/index.html が /api/ep-text で 200 のときだけ読み込む共通の部品（ep/_shared/）。有料の中身を入れない・二重に持たない ----
const sharedDir=path.join(__dirname,'../../ep/_shared');
const shared=()=>({js:fs.readFileSync(path.join(sharedDir,'text-view.js'),'utf8'),css:fs.readFileSync(path.join(sharedDir,'text-view.css'),'utf8')});
test('production buyer view: ep/_shared parts carry no paid content (no text sentence, no hint table, no marker, no red-sheet marks)',()=>{
  const {js,css}=shared(),built=require('../api/_ep-text/ep1');
  for(const [f,h] of [['text-view.js',js],['text-view.css',css]]){
    assert.doesNotMatch(h,/class="[^"]*\brs\b[^"]*"|role="button"|今回の数字|class="[^"]*(?:key|aside)|_ep-text|api\/ep-text|api\/session|tpl-css/,f);
    for(const w of ['転貸','又貸し','適用されない','事務所に数える','継続して業務ができる施設','取消しの理由','聴聞の公示','駆け込み廃業も取消し','いる／いらない','知事／大臣','欠格になる／欠格にならない'])assert.ok(!h.includes(w),f+':'+w);
    assert.ok(!h.includes('なぜ、駆け込み廃業も取消しと同じ扱いなの'),f);
    assert.doesNotMatch(h,/[→←↑↓]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,f);
  }
  // テキストの文（8字以上の字の並び）が1つも入っていない
  const sentences=built.replace(/<style>[\s\S]*?<\/style>/g,'').split(/<[^>]+>/).map(x=>x.trim()).filter(x=>x.length>=8);
  assert.ok(sentences.length>20);
  for(const t of sentences)assert.ok(!js.includes(t)&&!css.includes(t),t);
});
test('production buyer view: the shared js/css are the same parts as the trial page and the sample page (no second copy of the red sheet)',()=>{
  const {js,css}=shared(),dan=fs.readFileSync(path.join(__dirname,'../ep1-3dan.html'),'utf8'),sampleHtml=sample();
  const view=dan.match(/  function esc\(s\)[\s\S]*?(?=\n  function getText\(preview\))/)[0];
  // 共通の部品は、回の番号を住所（/ep/N）から読み、今回の数字が0組の回も出せるよう、試し用のコードに数か所だけ手を入れてある（build-ep.mjs）
  const lines=s=>s.split('\n').map(l=>l.trim()).filter(Boolean);
  const jsLines=new Set(lines(js));
  assert.ok(lines(view).filter(l=>!jsLines.has(l)).length<=12,'showBuyer + setupSheet（手を入れた所は12行まで）');
  const sheetJs=dan.match(/  function esc\(s\)[\s\S]*?(?=\n  function showBuyer\(html\))/)[0];
  assert.ok(js.includes(sheetJs)&&sampleHtml.includes(sheetJs),'setupSheet is the same in trial, shared and sample');
  for(const re of [/\.sbar2\{[\s\S]*?\.sb2:focus-visible\{[^}]*\}/,/\.jump\{[^}]*\}\n\.jb\{[^}]*\}\n\.jb:active\{[^}]*\}/,/\.is-buyer \.tcard[^\n]*\n\.thost\{[^\n]*\n\.textwrap\{[^\n]*\n\.is-buyer #text1[^\n]*\n/]){
    const part=dan.match(re)[0];assert.ok(css.includes(part),String(re));
  }
  assert.ok(sampleHtml.includes(dan.match(/\.sbar2\{[\s\S]*?\.sb2:focus-visible\{[^}]*\}/)[0]));
  assert.match(css,/:root\{--navh:48px\}/);
  assert.match(js,/window\.TakkenTextView = \{ show: showBuyer \}/);
  assert.match(js,/'\/api\/ep-pdf\?ep=' \+ epNo/);assert.match(js,/var epNo = \(\/\\\/ep\\\/\(\\d\+\)/);
});
test('production ep/1/index.html: ep-text is called only after the login check, only with a session; 401/403/failure leave the page as it is; ep-view gets tier text',()=>{
  const h=fs.readFileSync(path.join(__dirname,'../../ep/1/index.html'),'utf8');
  assert.equal((h.match(/fetch\('\/api\/ep-text\?ep=1'/g)||[]).length,1);
  assert.doesNotMatch(h,/api\/ep-text\?ep=1&|mihon=1|ALLOW_TEXT_PREVIEW/);
  // ログインの確認（TakkenProgress.init）が済んでから textCheck。セッション（provider）が無ければ呼ばない
  assert.match(h,/judged\.then\(goProgress, goProgress\)\.then\(textCheck\)\.then\(settleView, settleView\)/);
  assert.match(h,/who = window\.TakkenProgress && window\.TakkenProgress\.provider\(\)[\s\S]{0,200}if \(!who\) \{ setText\('呼んでいない/);
  assert.match(h,/if \(res\.status === 200 && typeof res\.json\.html === 'string'\) \{ return showText\(res\.json\.html\); \}/);
  assert.match(h,/\/ep\/_shared\/text-view\.css[\s\S]{0,60}\/ep\/_shared\/text-view\.js/);
  assert.match(h,/window\.umami\.track\('ep-view', \{ep: '1', tier: kind\}\)/);assert.match(h,/sendView\('text'\)/);
  assert.match(h,/\['text', textState\]/);
  // 二重にログインしない：progress-sync には liffId を渡さない・このページは /api/session を直接呼ばない
  assert.ok(!/TakkenProgress\.init\(\{liffId/.test(h));assert.doesNotMatch(h,/api\/session/);
});

test('print-only bands (page bar 1／2・2／2, print title, next/problem bands) are not in any build output',()=>{
  const outs={buyer:require('../api/_ep-text/ep1').replace(/<style>[\s\S]*?<\/style>/,''),prod:require('../../api/_ep-text/ep1').replace(/<style>[\s\S]*?<\/style>/,''),
    sample:sample().replace(/<style>[\s\S]*?<\/style>/g,''),nukigaki:fs.readFileSync(path.join(__dirname,'../ep/1/tsuzuki.html'),'utf8'),tsuzuki:fs.readFileSync(path.join(__dirname,'../../ep/1/tsuzuki.html'),'utf8')};
  for(const [k,h] of Object.entries(outs))assert.doesNotMatch(h,/1／2|2／2|class="pbar"|class="ttl"|class="next"|耳で覚える宅建2027　やさしいテキスト|この回の問題を解く|@media print/,k);
  const b=outs.buyer;assert.equal((b.match(/<figure/g)||[]).length,8);assert.equal((b.match(/class="[^"]*\brs\b/g)||[]).length,30);assert.equal((b.match(/class="nr"/g)||[]).length,6);
});
test('sample page: the entrance note is back (13px, not lighter than #4E5B66) and the buyer screen does not have it',()=>{
  const html=sample();
  assert.match(html,/<p class="about-t">このテキストは、宅建の全体をつかむための入り口です。概要をつかんだら、試験対策として、例外や細かい知識を過去問やお手持ちの参考書でご確認ください。<\/p>/);
  assert.match(html,/\.about-t\{font-size:13px;[^}]*color:#4E5B66/);
  assert.ok(html.indexOf('id="numbers"')<html.indexOf('id="honban"')&&html.indexOf('class="pdfbtn"')<html.indexOf('class="about-t"'));
  assert.ok(!fs.readFileSync(path.join(__dirname,'../ep1-3dan.html'),'utf8').includes('入り口です'));
  assert.ok(!require('../api/_ep-text/ep1').includes('入り口です'));
});

test('sample page: the 6 true/false questions and the past-exam question come from production (ep/1), no link to the 図解と3問 page, no memo buttons',()=>{
  const html=sample(),prod=path.join(__dirname,'../../ep/1');
  const idx=fs.readFileSync(path.join(prod,'index.html'),'utf8'),lf=fs.readFileSync(path.join(prod,'line-full.js'),'utf8').replace(/\r\n?/g,'\n').trim();
  const quiz=src=>JSON.parse(src.match(/var QUIZ = (\[.*\]);/)[1]);
  const Q=quiz(idx);
  assert.deepEqual(Q.map(g=>g.questions.length),[3,3]);
  assert.deepEqual(quiz(html),Q);// 問題文・解説・正答が本番と一字も違わない
  assert.deepEqual(quiz(fs.readFileSync(path.join(__dirname,'../ep1-3dan.html'),'utf8')),Q);// 購入者の画面とも同じ
  assert.ok(html.includes(lf),'line-full.js');// 過去問1選のデータと動きは本番のものがそのまま入っている
  const kk=JSON.parse(lf.match(/var KK = (\{.*\});/)[1]);
  assert.ok(kk.stem.length>0&&kk.items.length===4);
  assert.match(html,/id="q1"|b\.id = 'q' \+ \(i \+ 1\)/);
  assert.match(html,/<div class="over kk-over">チャレンジ！<\/div>\s*<h2 class="sec-h">過去問1選<\/h2>\s*<div id="kkBox">/);
  assert.match(html,/localStorage\.setItem\('takken2027-done'/);assert.match(html,/cookieHint: true/);assert.match(html,/\/progress-sync\.js/);
  // 図解と3問のページへ行かせる案内は無い（表の見出しは表の名前なので残る）
  assert.doesNotMatch(html,/href="\/ep\/1[?#"]|href="https:\/\/takken\.mimiobo\.com\/ep\/1[?#"]|【図解と3問】第1回へ|のページで解けます/);
  assert.equal((html.match(/【図解と3問】/g)||[]).length,1);
  assert.doesNotMatch(html,/class="dm"|選択肢ごとに○×のメモ/);
  // 並び（実行後）：前半テキスト→q1→後半テキスト→q2。script が3問を移す先
  assert.match(html,/getElementById\('text1'\)\.appendChild\(q1\)/);assert.match(html,/getElementById\('text2'\)\.appendChild\(q2\)/);
});

// ---- 配信日まで閉じる：ep<N>.meta.json の open（日本時間のその日の 0:00 から）。第1回は閉じない。mihon=1（ALLOW_TEXT_PREVIEW=1）は日付に関係なく返す ----
async function atTime(iso,fn){const real=Date.now;Date.now=()=>Date.parse(iso);try{return await fn();}finally{Date.now=real;}}
test('ep-text / ep-pdf: before the delivery date (JST) 404 even with the right; from 0:00 JST 200; ep1 is never closed',async()=>{
  const meta=JSON.parse(fs.readFileSync(path.join(__dirname,'../api/_ep-text/ep2.meta.json'),'utf8'));
  assert.equal(meta.open,'2027-01-12');
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname,'../api/_ep-text/ep1.meta.json'),'utf8')).open,undefined);
  const orig=pdfApi.source.read;pdfApi.source.read=()=>Buffer.from('%PDF-test');
  try{
    await atTime('2027-01-11T14:59:59Z',async()=>{// 2027-01-11 23:59:59 JST
      database();
      const a=response();await textApi(request('ep=2'),a);assert.equal(a.code,404);assert.deepEqual(a.data,{error:'not_found'});
      const b=pdfResponse();await pdfApi(request('ep=2',{},'/api/ep-pdf'),b);assert.equal(b.code,404);
      const c=response();await textApi(request('ep=1'),c);assert.equal(c.code,200);
      process.env.ALLOW_TEXT_PREVIEW='1';
      const d=response();await textApi(request('ep=2&mihon=1',{cookie:undefined}),d);assert.equal(d.code,200);
      delete process.env.ALLOW_TEXT_PREVIEW;
    });
    await atTime('2027-01-11T15:00:00Z',async()=>{// 2027-01-12 0:00:00 JST
      database();
      const a=response();await textApi(request('ep=2'),a);assert.equal(a.code,200);
      const b=pdfResponse();await pdfApi(request('ep=2',{},'/api/ep-pdf'),b);assert.equal(b.code,200);
      database({entitlements:[]});
      const c=response();await textApi(request('ep=2'),c);assert.equal(c.code,403);
    });
  }finally{pdfApi.source.read=orig;}
});
