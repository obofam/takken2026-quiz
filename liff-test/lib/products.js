'use strict';
// 2027の商品の台帳。値段（仮置き・Keiの最終決定ではない）・plan・Stripeのlookup_keyはここだけに書く。
// DBには「買ったplan」を1行だけ書き、含む関係はサーバーで読むときに広げる（includes / has）。
const PRODUCTS=[
  {code:'text',name:'やさしいテキスト',price:2980,plan:'text'},
  {code:'haru8',name:'春の8週',price:4980,plan:'haru'},
  {code:'natsu8',name:'夏の8週',price:5980,plan:'natsu'},
  {code:'last30',name:'ラスト30日プログラム',price:9800,plan:'last30'},
  {code:'last30_hayawari',name:'ラスト30日プログラム（早割）',price:8800,plan:'last30'},
  {code:'zenbu',name:'全部入り',price:19800,plan:'zenbu'},
  {code:'bansou',name:'伴走',price:39800,plan:'bansou'},
  {code:'bansou_1ki',name:'伴走（第1期の方）',price:10000,plan:'bansou'}
].map(p=>Object.freeze({...p,lookupKey:'takken2027_'+p.code}));
// DBが受け付ける plan（matome は単独で付与しない）。ume/take/matsu は互換のため残す。
const LEGACY_PLANS=['ume','take','matsu'];
const GRANTABLE_PLANS=[...LEGACY_PLANS,'text','haru','natsu','last30','zenbu','bansou'];
const ZENBU=['zenbu','text','haru','natsu','last30','matome'];
const INCLUDES={zenbu:ZENBU,bansou:['bansou',...ZENBU]};
function find(code){return PRODUCTS.find(p=>p.code===code)||null;}
// その plan が含む plan の一覧（自分自身を含む）。
function includes(plan){return INCLUDES[plan]?[...INCLUDES[plan]]:[plan];}
// 期限内の権利のどれかが plan を含むか。
function has(entitlements,plan,now=Date.now()){
  return Array.isArray(entitlements)&&entitlements.some(e=>e&&(e.valid_until==null||Date.parse(e.valid_until)>now)&&includes(e.plan).includes(plan));
}
// 画面表示用：持っている権利を含む関係で広げた plan の一覧。
function expand(entitlements,now=Date.now()){
  const out=new Set();
  for(const e of Array.isArray(entitlements)?entitlements:[])if(e&&(e.valid_until==null||Date.parse(e.valid_until)>now))for(const p of includes(e.plan))out.add(p);
  return [...out];
}
module.exports={PRODUCTS,LEGACY_PLANS,GRANTABLE_PLANS,find,includes,has,expand};
