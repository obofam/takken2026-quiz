'use strict';
// やさしいテキスト：買った方にだけ、第2〜5回を配信日より前に読めるようにする（Kei 11/27「予習に使うから第5回くらいまで」）。
// 設定の元は scripts/ep-config.mjs の BUYER_EARLY_MAX 1か所。build が ep<N>.meta.json に buyerEarly:true を書き、API はその印だけを読む。
// 配信日前の返し方：未ログイン 401／権利なし 403（第2〜5回）。第6回以降は、配信日の BUYER_EARLY_DAYS（7）日前の 0:00（日本時間）より前は 404、その日から 401／403／200（Kei 11/27「放送の1週間前から」）。配信日以降は今までどおり。
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
  assert.equal(C.BUYER_EARLY_DAYS,7);
  for(const n of [6,7,8,9]){const m=metaOf(n);assert.equal(m.buyerEarly,undefined,'ep'+n);const d=new Date(m.open+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-C.BUYER_EARLY_DAYS);assert.equal(m.buyerOpen,d.toISOString().slice(0,10),'ep'+n+' buyerOpen = open - BUYER_EARLY_DAYS');}
  assert.equal(metaOf(6).buyerOpen,'2027-02-01');
  for(const n of [1,2,3,4,5])assert.equal(metaOf(n).buyerOpen,undefined,'ep'+n);
  // API 側に回の数字（5 など）は持たない：印だけを読む
  for(const f of ['ep-text.js','ep-pdf.js']){const src=read(path.join(root,'api',f)).split(/\r?\n/).filter(l=>!l.startsWith('//')).join(' ');assert.match(src,/buyerEarly/);assert.match(src,/buyerOpen/);assert.doesNotMatch(src,/BUYER_EARLY_MAX|BUYER_EARLY_DAYS|<=\s*5|\b7\b/);}
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

test('more than 7 days before the delivery date, ep 6 and later: 404 even with the right (and anonymous: 404, not 401); mihon=1 behaves as before',async()=>{
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

test('on and after the delivery date nothing changes: ep 2 is open from 2027-01-12 as ever; ep 6 stays open to buyers up to and after 2027-02-08; ep 1 is never closed',async()=>{
  const orig=pdfApi.source.read;pdfApi.source.read=()=>Buffer.from('%PDF-test');
  try{
    await atTime('2027-01-11T15:00:00Z',async()=>{database();await both('ep=2',{},200,'ep2 on the day');database({entitlements:[]});await both('ep=2',{},403,'ep2 no right');await both('ep=2',{cookie:undefined},401,'ep2 anon');});
    await atTime('2027-02-07T15:00:00Z',async()=>{database();await both('ep=6',{},200,'ep6 on the day');});
    await atTime('2027-02-20T00:00:00Z',async()=>{database();await both('ep=6',{},200,'ep6 after the day');database({entitlements:[]});await both('ep=6',{},403,'ep6 no right after');await both('ep=6',{cookie:undefined},401,'ep6 anon after');});
    await atTime('2026-12-01T00:00:00Z',async()=>{database();await both('ep=1',{},200,'ep1');});
  }finally{pdfApi.source.read=orig;}
});

test('ep 6 and later: from 0:00 JST seven days before the delivery date the right opens it (200), no right 403, anonymous 401; the second before: 404 for everyone',async()=>{
  const orig=pdfApi.source.read;pdfApi.source.read=()=>Buffer.from('%PDF-test');
  try{
    // 第6回の配信日 2027-02-08 → 買った方に開く日 2027-02-01 の 0:00 JST ＝ 2027-01-31T15:00:00Z
    await atTime('2027-01-31T14:59:59Z',async()=>{database();await both('ep=6',{},404,'ep6 one second before');await both('ep=6',{cookie:undefined},404,'ep6 anon one second before');database({entitlements:[]});await both('ep=6',{},404,'ep6 no right one second before');});
    await atTime('2027-01-25T00:00:00Z',async()=>{database();await both('ep=6',{},404,'ep6 eight days before');});
    await atTime('2027-01-31T15:00:00Z',async()=>{
      database();const ok=await both('ep=6',{},200,'ep6 right');assert.equal(typeof ok.data.html,'string');
      database({entitlements:[]});const no=await both('ep=6',{},403,'ep6 no right');assert.equal(no.data.html,undefined);assert.deepEqual(no.data,{error:'text_not_entitled'});
      database({entitlements:[{plan:'ume',valid_until:null}]});await both('ep=6',{},403,'ep6 other plan');
      database();const anon=await both('ep=6',{cookie:undefined},401,'ep6 anon');assert.equal(anon.data.html,undefined);
      // 第7回（配信日 2027-02-15）はまだ 404
      database();await both('ep=7',{},404,'ep7 not yet');
    });
    await atTime('2027-02-07T14:59:59Z',async()=>{database();await both('ep=6',{},200,'ep6 the day before the date');});
    await atTime('2027-02-07T15:00:00Z',async()=>{database();await both('ep=6',{},200,'ep6 on the date');database({entitlements:[]});await both('ep=6',{},403,'ep6 no right on the date');});
    await atTime('2027-02-08T15:00:00Z',async()=>{database();await both('ep=7',{},200,'ep7 seven days before its date');});
    await atTime('2027-02-14T15:00:00Z',async()=>{database();await both('ep=7',{},200,'ep7 on the date');});
  }finally{pdfApi.source.read=orig;}
});

test('ep pages 2-5 (prod and trial): the pre-date branch checks /api/ep-text only (no LINE judge); ep 6-9 check it only from 7 days before the date (ep-buyer-open), otherwise as before; buyers lose the "opens on the date" note',()=>{
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
      // 配信日の7日前より前は、買っていない方と同じ動き（settleView して記録の同期だけ）。7日前から（html.ep-buyer-open）だけ、記録の同期のあと /api/ep-text を確かめる
      const i=h.indexOf("document.documentElement.classList.contains('ep-early')"),j=h.indexOf('var judged;');
      assert.ok(i>0&&i<j,'ep'+n);
      const block=h.slice(i,j);
      assert.match(block,/classList\.contains\('ep-buyer-open'\)\) \{\n\s+var ps = null;[\s\S]*?Promise\.resolve\(ps\)\.catch\(function \(\) \{\}\)\.then\(textCheck\)\.then\(settleView, settleView\);\n\s+\} else \{\n\s+settleView\(\);\n\s+try \{ if \(window\.__epProgressStart\) \{ window\.__epProgressStart\(\); \} \} catch \(_\) \{\}\n\s+\}/);
      assert.doesNotMatch(block,/showFull|liff\.init|judge\(|ep-closed/);
      assert.match(h,/\.is-buyer \.early-note,\.is-buyer \.early-to1\{display:none !important\}/);
      assert.doesNotMatch(h,/ep-closed|closed-box/);
      // 配信日の鍵は今のまま（買っていない方は ep-early）。7日前の鍵（ep-buyer-open）は meta の buyerOpen と同じ日
      const kb=Number(metaOf(n).buyerOpen.replace(/-/g,''));
      assert.match(h,new RegExp("var k="+Number(metaOf(n).open.replace(/-/g,''))+";[^<]*?if\\(t<k\\)\\{document\\.documentElement\\.className\\+=' ep-early';if\\(t>="+kb+"\\)\\{document\\.documentElement\\.className\\+=' ep-buyer-open';\\}\\}"));
    }
  }
});

test('ep nav: ep 2-5 and the next one (6) are links even before their date (buyers can move 1<->5 and the free view is open to all)',()=>{
  for(const n of [2,3,4,5]){const h=read(path.join(prod,'ep',String(n),'index.html'));assert.doesNotMatch(h,/data-open=/);assert.match(h,new RegExp('<a class="enb next" href="/ep/'+(n+1)+'"'));}
});

test('売り場：購入済みの箱と購入完了に「第1回〜第5回」のリンク、文は第5回まで＋放送の1週間前に次の回が開く（日付は出さない）',()=>{
  for(const base of [root,prod]){
    const h=read(path.join(base,'kounyu.html')),js=read(path.join(base,'kounyu.js'));
    const owned=h.slice(h.indexOf('id="owned"'),h.indexOf('<div id="buy"'));
    for(let n=1;n<=5;n++)assert.match(owned,new RegExp('<a class="btn ghost sm" href="/ep/'+n+'/">第'+n+'回</a>'));
    assert.doesNotMatch(owned,/第6回/);
    assert.match(h,/現在は第5回まで読めます。そのあとは、放送の1週間前に次の回が開きます。/);
    assert.doesNotMatch(h,/第6回は2027年2月8日/);
    assert.doesNotMatch(h,/第2回は2027年1月12日|現在は第1回を公開/);
    assert.match(js,/for\(let i=1;i<=5;i\+\+\)row\.appendChild\(link\('btn ghost sm','\/ep\/'\+i\+'\/','第'\+i\+'回'\)\)/);
  }
  assert.equal(metaOf(6).open,'2027-02-08');
});
