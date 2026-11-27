'use strict';
// やさしいテキスト：買った方にだけ、第2〜5回を配信日より前に読めるようにする（Kei 11/27「予習に使うから第5回くらいまで」）。
// 設定の元は scripts/ep-config.mjs の BUYER_EARLY_MAX 1か所。build が ep<N>.meta.json に buyerEarly:true を書き、API はその印だけを読む。
// 配信日前の返し方：未ログイン 401／権利なし 403（第2〜5回）。第6回以降は今までどおり 404。配信日以降は今までどおり。
const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const s=require('../lib/server');
const textApi=require('../api/ep-text');
const pdfApi=require('../api/ep-pdf');
const root=path.join(__dirname,'..'),prod=path.join(root,'..');
const read=p=>fs.readFileSync(p,'utf8');
const metaOf=n=>JSON.parse(read(path.join(root,'api/_ep-text','ep'+n+'.meta.json')));
const originalFetch=global.fetch,originalEnv={...process.env};
const user='12345678-1234-4123-8123-123456789abc';
beforeEach(()=>{
  Object.assign(process.env,{SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'});
  delete process.env.ALLOW_TEXT_PREVIEW;
  global.fetch=async()=>{throw Error('unmocked fetch');};
});
after(()=>{global.fetch=originalFetch;process.env=originalEnv;});
function response(){const headers={};return {code:0,data:null,body:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;},send(b){this.body=b;return this;}};}
const cookie=()=>s.COOKIE+'='+s.sign({purpose:'session',userId:user,provider:'email',subject:'tester@example.com',exp:Date.now()/1000+600});
const request=(query,patch={},url='/api/ep-text')=>({method:'GET',url:url+'?'+query,headers:{host:'localhost:3000',cookie:cookie(),...patch}});
function database({entitlements=[{plan:'text',valid_until:null}]}={}){
  global.fetch=async url=>{
    const u=new URL(url);let data;
    if(u.pathname==='/rest/v1/allowlist')data=[{provider:'email'}];
    else if(u.pathname==='/rest/v1/identities')data=[{user_id:user}];
    else if(u.pathname==='/rest/v1/entitlements')data=entitlements;
    else assert.fail('unexpected query '+u.pathname);
    return {ok:true,status:200,json:async()=>data};
  };
}
async function atTime(iso,fn){const real=Date.now;Date.now=()=>Date.parse(iso);try{return await fn();}finally{Date.now=real;}}
const both=async(query,patch,want,label)=>{
  const a=response();await textApi(request(query,patch),a);assert.equal(a.code,want,'ep-text '+label);
  const b=response();await pdfApi(request(query,patch,'/api/ep-pdf'),b);assert.equal(b.code,want,'ep-pdf '+label);
  return a;
};

test('config: BUYER_EARLY_MAX is the one source (5); build writes buyerEarly:true on ep 2-5 only (not ep 1, not 6 and later)',async()=>{
  const C=await import(require('node:url').pathToFileURL(path.join(root,'scripts','ep-config.mjs')).href);
  assert.equal(C.BUYER_EARLY_MAX,5);
  for(let n=2;n<=C.BUYER_EARLY_MAX;n++){assert.equal(metaOf(n).buyerEarly,true,'ep'+n);assert.ok(C.FREE_EARLY_EPS.includes(n));}
  assert.equal(metaOf(1).buyerEarly,undefined);assert.equal(metaOf(1).open,undefined);
  for(const n of [6,7,8,9])assert.equal(metaOf(n).buyerEarly,undefined,'ep'+n);
  // API 側に回の数字（5 など）は持たない：印だけを読む
  for(const f of ['ep-text.js','ep-pdf.js']){const src=read(path.join(root,'api',f)).split(/\r?\n/).filter(l=>!l.startsWith('//')).join(' ');assert.match(src,/buyerEarly/);assert.doesNotMatch(src,/BUYER_EARLY_MAX|<=\s*5/);}
});

test('before the delivery date, ep 2-5: right -> 200, no right -> 403, not logged in -> 401 (text and pdf)',async()=>{
  const orig=pdfApi.source.read;pdfApi.source.read=()=>Buffer.from('%PDF-test');
  try{
    await atTime('2026-12-01T00:00:00Z',async()=>{
      for(const n of [2,3,4,5]){
        database();
        const ok=await both('ep='+n,{},200,'ep'+n+' right');assert.equal(typeof ok.data.html,'string');
        database({entitlements:[]});
        const no=await both('ep='+n,{},403,'ep'+n+' no right');assert.deepEqual(no.data,{error:'text_not_entitled'});assert.equal(no.data.html,undefined);
        database({entitlements:[{plan:'ume',valid_until:null}]});
        await both('ep='+n,{},403,'ep'+n+' other plan');
        database();
        const anon=await both('ep='+n,{cookie:undefined},401,'ep'+n+' anon');assert.equal(anon.data.html,undefined);assert.equal(anon.data.error,'login_required');
      }
    });
  }finally{pdfApi.source.read=orig;}
});

test('before the delivery date, ep 6 and later: 404 even with the right (and anonymous: 404, not 401); mihon=1 behaves as before',async()=>{
  const orig=pdfApi.source.read;pdfApi.source.read=()=>Buffer.from('%PDF-test');
  try{
    await atTime('2026-12-01T00:00:00Z',async()=>{
      for(const n of [6,7,8,9]){
        database();
        const a=await both('ep='+n,{},404,'ep'+n+' right');assert.deepEqual(a.data,{error:'not_found'});
        await both('ep='+n,{cookie:undefined},404,'ep'+n+' anon');
      }
      process.env.ALLOW_TEXT_PREVIEW='1';
      const d=response();await textApi(request('ep=6&mihon=1',{cookie:undefined}),d);assert.equal(d.code,200);
      const e=response();await textApi(request('ep=3&mihon=1',{cookie:undefined}),e);assert.equal(e.code,200);
      delete process.env.ALLOW_TEXT_PREVIEW;
    });
  }finally{pdfApi.source.read=orig;}
});

test('on and after the delivery date nothing changes: ep 2 opens at 0:00 JST on 2027-01-12; ep 6 at 2027-02-08; ep 1 is never closed',async()=>{
  const orig=pdfApi.source.read;pdfApi.source.read=()=>Buffer.from('%PDF-test');
  try{
    await atTime('2027-01-11T15:00:00Z',async()=>{database();await both('ep=2',{},200,'ep2 on the day');database({entitlements:[]});await both('ep=2',{},403,'ep2 no right');await both('ep=2',{cookie:undefined},401,'ep2 anon');});
    await atTime('2027-02-07T14:59:59Z',async()=>{database();await both('ep=6',{},404,'ep6 the day before');});
    await atTime('2027-02-07T15:00:00Z',async()=>{database();await both('ep=6',{},200,'ep6 on the day');});
    await atTime('2026-12-01T00:00:00Z',async()=>{database();await both('ep=1',{},200,'ep1');});
  }finally{pdfApi.source.read=orig;}
});

test('ep pages 2-5 (prod and trial): the pre-date branch checks /api/ep-text only (no LINE judge); ep 6-9 are the same as before; buyers lose the "opens on the date" note',()=>{
  for(const base of [prod,root]){
    for(const n of [2,3,4,5]){
      const h=read(path.join(base,'ep',String(n),'index.html'));
      const i=h.indexOf("document.documentElement.classList.contains('ep-early')"),j=h.indexOf('var judged;');
      assert.ok(i>0&&i<j,'ep'+n);
      const block=h.slice(i,j);
      assert.match(block,/Promise\.resolve\(ps\)\.catch\(function \(\) \{\}\)\.then\(textCheck\)\.then\(settleView, settleView\)/);
      assert.doesNotMatch(block,/showFull|liff\.init|judge\(|ep-closed/);
      assert.doesNotMatch(block,/settleView\(\);\n/,'確認が済む前に見え方を確定して数えない');
      assert.match(h,/\.is-buyer \.early-note,\.is-buyer \.early-to1\{display:none !important\}/);
      assert.doesNotMatch(h,/ep-closed|closed-box/);
      assert.match(h,/<script>\(function\(\)\{var k=\d+;[\s\S]*?ep-early';\}\}\)\(\);<\/script>/);// 配信日の鍵は今のまま（買っていない方は ep-early）
    }
    for(const n of [6,7,8,9]){
      const h=read(path.join(base,'ep',String(n),'index.html'));
      assert.match(h,/pendView\('open'\); settleView\(\);/);
      assert.doesNotMatch(h,/\.is-buyer \.early-note/);
      assert.doesNotMatch(h.slice(h.indexOf("classList.contains('ep-early')"),h.indexOf('var judged;')),/textCheck/);
    }
  }
});

test('ep nav: ep 2-5 and the next one (6) are links even before their date (buyers can move 1<->5 and the free view is open to all)',()=>{
  for(const n of [2,3,4,5]){const h=read(path.join(prod,'ep',String(n),'index.html'));assert.doesNotMatch(h,/data-open=/);assert.match(h,new RegExp('<a class="enb next" href="/ep/'+(n+1)+'"'));}
});

test('売り場：購入済みの箱と購入完了に「第1回〜第5回」のリンク、文は第5回まで・第6回は2月8日',()=>{
  for(const base of [root,prod]){
    const h=read(path.join(base,'kounyu.html')),js=read(path.join(base,'kounyu.js'));
    const owned=h.slice(h.indexOf('id="owned"'),h.indexOf('<div id="buy"'));
    for(let n=1;n<=5;n++)assert.match(owned,new RegExp('<a class="btn ghost sm" href="/ep/'+n+'/">第'+n+'回</a>'));
    assert.doesNotMatch(owned,/第6回/);
    assert.match(h,/現在は第5回まで読めます。第6回は2027年2月8日に追加します。/);
    assert.doesNotMatch(h,/第2回は2027年1月12日|現在は第1回を公開/);
    assert.match(js,/for\(let i=1;i<=5;i\+\+\)row\.appendChild\(link\('btn ghost sm','\/ep\/'\+i\+'\/','第'\+i\+'回'\)\)/);
  }
  assert.equal(metaOf(6).open,'2027-02-08');
});
