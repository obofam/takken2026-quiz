'use strict';
// kounyu.html / kounyu.js：状態の決め方・書式・決め打ちが無いこと。
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const html=read('kounyu.html'),js=read('kounyu.js');
const K=require('../kounyu.js');

const offer=(o)=>({text:Object.assign({kind:'start',price:2480,listPrice:2980,startPrice:2480,until:'2027-01-11',basis:'open'},o)});
const data=(o)=>Object.assign({products:[{code:'text',name:'やさしいテキスト',price:2980,plan:'text'}],loggedIn:false,owned:[],offers:offer(),validUntil:'2027-10-17'},o);
const dec=(o)=>K.decide(Object.assign({loaded:true,failed:false,checkout:null,verify:null,host:'takken.mimiobo.com'},o));

test('書式',()=>{
  assert.equal(K.yen(2480),'2,480円');
  assert.equal(K.yen(980),'980円');
  assert.equal(K.dateLong('2027-01-11'),'2027年1月11日');
  assert.equal(K.dateShort('2027-01-20'),'1月20日');
  assert.equal(K.dateLong('2027-10-17'),'2027年10月17日');
});

test('読み込み中と API 失敗',()=>{
  assert.equal(K.decide({loaded:false,host:'x'}).state,'loading');
  const e=dec({data:null,failed:true});
  assert.equal(e.state,'error');assert.equal(e.priceError,true);assert.equal(e.button,null);
  assert.equal(dec({data:{},failed:false}).button,null);
});

test('未ログイン：スタート価格（open）',()=>{
  const v=dec({data:data()});
  assert.equal(v.state,'guest');assert.equal(v.button,'login');
  assert.equal(v.price.early,true);assert.equal(v.price.amount,'2,480円');
  assert.equal(v.price.was,'2,980円');assert.equal(v.price.off,'500円OFF');
  assert.equal(v.price.note,'2027年1月11日までは、どなたでもこの価格です。以降は、登録から7日間が対象です。');
  assert.equal(dec({data:data({offers:offer({price:2380})})}).price.off,'600円OFF','差額は計算で出す');
  assert.ok(v.price.lines.includes('利用期間は、2027年10月17日（本試験日）までです。'));
  assert.ok(v.price.lines.includes('お支払いはクレジットカードです。決済はStripeの画面で行います。'));
});

test('ログイン中：スタート価格（touroku）と通常価格',()=>{
  const t=dec({data:data({loggedIn:true,offers:offer({basis:'touroku',until:'2027-01-20'})})});
  assert.equal(t.state,'member');assert.equal(t.button,'buy');
  assert.equal(t.price.note,'登録から7日間は、この価格でご購入いただけます。（1月20日まで）');
  const n=dec({data:data({loggedIn:true,offers:offer({kind:'tsujo',price:2980,basis:null,until:null})})});
  assert.equal(n.price.amount,'2,980円');assert.equal(n.price.early,false);assert.equal(n.price.note,'');
  assert.ok(!n.price.lines.some(l=>l.includes('早割')));
});

test('通常価格：未ログインだけスタート価格の案内',()=>{
  const g=dec({data:data({offers:offer({kind:'tsujo',price:2980,basis:null,until:null})})});
  assert.ok(g.price.lines.includes('登録から7日間は、早割 2,480円でご購入いただけます。対象かどうかは、ログイン後に表示されます。'));
  assert.equal(g.button,'login');
});

test('購入ずみ（owned と 409）',()=>{
  const o=dec({data:data({loggedIn:true,owned:['text']})});
  assert.equal(o.state,'owned');assert.equal(o.button,null);assert.equal(o.price,null);
  const b=dec({data:data({loggedIn:true}),boughtNow:true});assert.equal(b.state,'owned');
});

test('戻ってきたとき・やめたとき',()=>{
  assert.equal(dec({data:data(),checkout:'ok',verify:'checking'}).thanks,'checking');
  assert.equal(dec({data:data({loggedIn:true,owned:['text']}),checkout:'ok',verify:'ok'}).thanks,'ok');
  assert.equal(dec({data:data({loggedIn:true}),checkout:'ok',verify:'slow'}).thanks,'slow');
  assert.equal(dec({data:data(),checkout:'cancel'}).cancel,true);
  assert.equal(dec({data:data()}).thanks,null);
});

test('試し用の印・ログイン入口・ロードマップの出し分け',()=>{
  assert.equal(dec({data:data()}).trial,false);
  const t=dec({data:data(),host:'mimiobo-liff-test.vercel.app'});
  assert.equal(t.trial,true);assert.equal(t.login,'/account.html?next=kounyu');assert.equal(t.roadmap,'/roadmap-an3.html');
  const p=dec({data:data()});
  assert.equal(p.login,'/login?next=/kounyu.html');assert.equal(p.roadmap,'/roadmap');
});

test('ページ：値段の決め打ちが無い・リンク・禁止文字・noindex',()=>{
  // html には通常価格の静的な表示（#price の最初の中身）だけがある。それ以外・js には決め打ちが無い
  const staticPrice='<div id="price"><p class="price-amount">2,980<span>円（税込）</span></p></div>';
  assert.ok(html.includes(staticPrice),'通常価格が最初から出ている');
  const htmlRest=html.replace(staticPrice,'');
  for(const n of ['2980','2480','2,980','2,480']){assert.ok(!htmlRest.includes(n),'html '+n);assert.ok(!js.includes(n),'js '+n);}
  assert.ok(!html.includes('読み込み中です'));assert.ok(!js.includes('読み込み中です'));
  assert.ok(js.includes("'price-arrow'")&&!js.includes('スタート価格'));
  assert.ok(html.includes('https://www.mimiobo.com/tokushoho'));
  assert.ok(html.includes('https://www.mimiobo.com/privacy'));
  assert.ok(/<meta name="robots" content="noindex"/.test(html));
  const arrows=/[→▼⇒›←↑↓▶►]/;
  const emoji=/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
  for(const s of [html,js]){assert.ok(!arrows.test(s));assert.ok(!emoji.test(s));}
  assert.ok(!/innerHTML/.test(js));
  for(const w of ['今だけ','お得','急いで','残り']){assert.ok(!html.includes(w)&&!js.includes(w),w);}
});
test('売り場でログインが確かめられたら、回のページと同じ「ログインした印」を付ける（買ったあとテキストに切り替わるため）',()=>{
  const core=require('../kounyu.js');
  assert.ok(read('progress-sync.js').includes("K_H = '"+core.LOGIN_HINT+"'"),'progress-sync.js の K_H と同じ名前');
  assert.ok(js.includes("if(d&&d.loggedIn===true){try{localStorage.setItem(LOGIN_HINT,'1');}catch(_){}}"));
  assert.ok(js.includes('markLogin(r.json)'));
});
