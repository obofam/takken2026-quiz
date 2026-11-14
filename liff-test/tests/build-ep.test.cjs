'use strict';
// scripts/build-ep.mjs：第1回が変わらない／第2〜9回が失敗せず出る／公開側に有料の中身が無い／出し先の決まり。
// 材料（6_有料PDF/やさしいテキスト_2027）が手元に無い環境では飛ばす。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),prod=path.join(root,'..');
const mat=path.join(prod,'..','6_有料PDF','やさしいテキスト_2027');
const skip=fs.existsSync(mat)?false:'材料が無い';
let B,shared;
const lib=async()=>{if(!B){B=await import(require('node:url').pathToFileURL(path.join(root,'scripts/build-ep.mjs')).href);shared=B.buildShared();}return B;};
const norm=b=>b;
const bytes=d=>Buffer.isBuffer(d)?d:Buffer.from(d);

test('build-ep: ep-release.json lists 1-9; production has ep/1-9 (4 files each, no text/ except ep 1) and api/_ep-text/ep1-9',{skip},()=>{
  const r=JSON.parse(fs.readFileSync(path.join(root,'ep-release.json'),'utf8'));
  assert.deepEqual(r,{prod:[1,2,3,4,5,6,7,8,9]});
  for(let n=1;n<=9;n++){
    const d=path.join(prod,'ep',String(n));
    for(const f of ['index.html','line-full.html','line-full.js','tsuzuki.html'])assert.ok(fs.existsSync(path.join(d,f)),n+'/'+f);
    assert.equal(fs.existsSync(path.join(d,'text')),n===1,'text/ は第1回だけ');
    assert.ok(fs.existsSync(path.join(prod,'api/_ep-text','ep'+n+'.js')));
  }
});
test('build-ep: episode 1 rebuilt = what is committed (ep/1 line-full, tsuzuki, sample page, api ep1.js/pdf, shared css)',{skip},async()=>{
  const b=await lib();
  const r=b.buildEp(1,{prod:[1]},shared);
  const same=['ep/1/line-full.html','ep/1/line-full.js','ep/1/tsuzuki.html','ep/1/text/index.html','liff-test/api/_ep-text/ep1.js','api/_ep-text/ep1.js','api/_ep-text/ep1.pdf','ep/_shared/text-view.css'];
  for(const rel of same){
    const f=r.files.find(x=>x.rel===rel)||b.sharedFiles(shared).find(x=>x.rel===rel);
    assert.ok(f,rel);
    assert.ok(norm(fs.readFileSync(path.join(prod,rel))).equals(norm(bytes(f.data))),rel);
  }
  // index.html と text-view.js は、書き出してコミットしたものと同じ（回の番号まわりを差し込む型に変えたため、手作りだった版との差は報告済み）
  for(const rel of ['ep/1/index.html']){const f=r.files.find(x=>x.rel===rel);assert.ok(norm(fs.readFileSync(path.join(prod,rel))).equals(norm(bytes(f.data))),rel);}
  assert.ok(fs.readFileSync(path.join(prod,'ep/_shared/text-view.js')).equals(bytes(b.sharedFiles(shared).find(x=>x.rel==='ep/_shared/text-view.js').data)));
  assert.deepEqual(r.report.rs,[12,12,6]);
});
test('build-ep: episodes 2-9 build without error; text-only figures and red-sheet answers are not in any public file',{skip},async()=>{
  const b=await lib();
  for(let ep=2;ep<=9;ep++){
    const r=b.buildEp(ep,{prod:[1]},shared);
    assert.equal(r.report.prod,false);
    assert.ok(r.files.every(f=>f.rel.startsWith('liff-test/')),'ep'+ep+' は本番へ書かない');
    for(const f of r.files.filter(x=>!x.secret)){
      assert.doesNotMatch(String(f.data),/class="[^"]*\brs\b[^"]*"|role="button"|data-hint|data-part=/,f.rel);
      assert.ok(!f.rel.includes('/text/'),'見本ページは第1回だけ');
    }
    const secret=r.files.filter(x=>x.secret);
    assert.deepEqual(secret.map(f=>f.rel.split('/').pop()).sort(),['ep'+ep+'.js','ep'+ep+'.meta.json','ep'+ep+'.pdf']);
    const mod={};new Function('module',r.files.find(f=>f.rel.endsWith('/ep'+ep+'.js')).data)(mod);const paid=mod.exports;
    assert.equal((paid.match(/class="[^"]*\brs\b/g)||[]).length,r.report.rsTotal);
    assert.equal(r.report.figs.free,1);
    assert.ok(r.report.leakChecked>0);
  }
});
test('build-ep: a find that is not unique in its page fails the build',{skip},async()=>{
  const b=await lib();
  const m=b.loadMaterial(2);
  m.json.redsheet.targets.push({half:1,fig:1,find:'<b>',text:'<b>',kind:'言葉'});
  assert.throws(()=>b.buildText(m),/find/);
  const m2=b.loadMaterial(2);
  m2.html=m2.html.replace('開業までの順番','開業までの順番（変えた）');
  m2.json.figures[0].cap='開業までの順番';
  assert.throws(()=>b.buildExcerpt(m2,b.buildText(m2)),/題が json と html で違う/);
});
test('build-ep: the API serves any built episode and the paid dirs are git-ignored',{skip},()=>{
  for(const rel of ['api/_ep-text/ep1.js','liff-test/api/_ep-text/ep2.js'])execFileSync('git',['check-ignore','-q',rel],{cwd:prod});
  for(let n=1;n<=9;n++){const h=require('../api/_ep-text/ep'+n);assert.match(h,/data-part="1"/);assert.match(h,/data-part="2"/);}
  assert.doesNotMatch(require('../api/_ep-text/ep8'),/data-part="3"/);// 今回の数字が0組の回は節を作らない
  assert.match(require('../api/_ep-text/ep2'),/○万円/);// 1,000万円 は ○万円
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'api/_ep-text/ep2.meta.json'),'utf8')).name,'やさしいテキスト_第2回_営業保証金と保証協会.pdf');
});
test('build-ep: trial pages carry the trial LIFF id and a buyer preview entrance (?mihon=kounyu); production pages do not',{skip},()=>{
  for(let n=1;n<=9;n++){
    const h=fs.readFileSync(path.join(root,'ep',String(n),'index.html'),'utf8');
    assert.match(h,/2011606963-hH0DzETc/);assert.doesNotMatch(h,/2012583516-7vmvMorb|cloud\.umami\.is/);
    assert.match(h,/mihon === 'kounyu' \? '&mihon=1'/);
    assert.match(h,new RegExp("fetch\\('/api/ep-text\\?ep="+n+"'"));
    assert.match(h,new RegExp('/ep/'+n+'/tsuzuki\\.html'));
  }
  const p=fs.readFileSync(path.join(prod,'ep/1/index.html'),'utf8');
  assert.match(p,/2012583516-7vmvMorb/);assert.doesNotMatch(p,/2011606963|kounyu|__epMihon/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'ep/2/index.html'),'utf8'),/2027年版の見本/);
});

const gateOf=h=>{const m=h.match(/<script>(\(function\(\)\{var k=[\s\S]*?)<\/script>/);return m?m[1]:null;};
const closedAt=(code,y,mo,d)=>{const html={className:''};const FD=function(){return {getFullYear:()=>y,getMonth:()=>mo-1,getDate:()=>d};};new Function('document','Date','location',code)({documentElement:html},FD,{search:''});return /ep-closed/.test(html.className);};
test('build-ep: production ep/2-9 are closed until the delivery date (the same rule as roadmap: device date >= date), ep/1 has no gate, no today override',{skip},()=>{
  const dates={2:[2027,1,12],3:[2027,1,18],4:[2027,1,25],5:[2027,2,1],6:[2027,2,8],7:[2027,2,15],8:[2027,2,22],9:[2027,3,1]};
  for(let n=2;n<=9;n++){
    const h=fs.readFileSync(path.join(prod,'ep',String(n),'index.html'),'utf8');
    const code=gateOf(h);assert.ok(code,'ep'+n);
    const [y,m,d]=dates[n];
    assert.equal(closedAt(code,y,m,d-1<1?1:d-1),d-1<1?false:true,'前日は閉');
    const prev=new Date(Date.UTC(y,m-1,d-1));
    assert.equal(closedAt(code,prev.getUTCFullYear(),prev.getUTCMonth()+1,prev.getUTCDate()),true,'前日は閉');
    assert.equal(closedAt(code,y,m,d),false,'当日は開');assert.equal(closedAt(code,y,m,d+1>28?d:d+1),false);
    assert.doesNotMatch(h,/today|__epMihon|kounyu/);
    assert.match(h,/2012583516-7vmvMorb/);assert.match(h,/cloud\.umami\.is/);
    assert.match(h,/<div class="next-box closed-box"><p>この回は、\d+年\d+月\d+日（.）からです。<\/p><a class="lbtn" href="\/roadmap">学習ロードマップへ<\/a><\/div>/);
    assert.equal((h.match(/ep-closed'\)\) \{ return; \}/g)||[]).length,2,'判定の script は閉じているとき動かない');
    assert.doesNotMatch(h,/class="[^"]*rs[^"]*"|role="button"|data-hint|data-part=|_ep-text/);
    for(const f of ['line-full.html','tsuzuki.html'])assert.doesNotMatch(fs.readFileSync(path.join(prod,'ep',String(n),f),'utf8'),/class="[^"]*rs[^"]*"|role="button"|data-hint|data-part=|今回の数字|ワンポイント/,n+f);
  }
  const p1=fs.readFileSync(path.join(prod,'ep/1/index.html'),'utf8');
  assert.equal(gateOf(p1),null);assert.doesNotMatch(p1,/ep-closed|closed-box/);
  // 試し用：ふだんは開いたまま。?today= を付けたときだけ判定
  const t2=fs.readFileSync(path.join(root,'ep/2/index.html'),'utf8');
  const code=gateOf(t2);
  const run=search=>{const html={className:''};new Function('document','location',code)({documentElement:html},{search});return /ep-closed/.test(html.className);};
  assert.equal(run(''),false);assert.equal(run('?today=2027-01-11'),true);assert.equal(run('?today=2027-01-12'),false);
});

test('build-ep: the leak guard looks at classes (.key / .aside / .rs / numbers), not at label words, and does fail on a deliberate leak',{skip},async()=>{
  const b=await lib();
  const m=b.loadMaterial(2),text=b.buildText(m),ex=b.buildExcerpt(m,text);
  const pages=b.buildPages(m,text,ex,'prod');
  assert.ok(b.checkPublic(m,text,ex,pages)>0);
  for(const leak of ['<div class="key"><span class="l">label</span></div>','<div class="aside"><span class="l">label</span></div>','<span class="rs" role="button" tabindex="0">x</span>','<div class="nl"></div>','<div class="tx" data-part="3"></div>']){
    assert.throws(()=>b.checkPublic(m,text,ex,{...pages,lineFullHtml:pages.lineFullHtml+leak}),/公開側/,leak);
    assert.throws(()=>b.checkPublic(m,text,{...ex,html:ex.html+leak},pages),/公開側/,leak);
  }
  // 札の字だけ（class なし）では落ちない＝字では見ていない
  assert.doesNotThrow(()=>b.checkPublic(m,text,ex,{...pages,lineFullHtml:pages.lineFullHtml+'<p>芯 今日のワンポイント</p>'}));
  // テキストだけの図の字が公開側に出たら落ちる
  const paidNo=Object.keys(ex.tier).find(n=>ex.tier[n]==='paid');
  const phrase=ex.orig[paidNo].split(/<[^>]+>/).map(x=>x.trim()).filter(x=>Array.from(x).length>=8).pop();
  assert.throws(()=>b.checkPublic(m,text,ex,{...pages,lineFullHtml:pages.lineFullHtml+'<p>'+phrase+'</p>'}),/図\d+の字が公開側/);
});
