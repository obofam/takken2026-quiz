// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
// 2027の商品の台帳。値段（仮置き・Keiの最終決定ではない）・plan・Stripeのlookup_keyはここだけに書く。
// DBには「買ったplan」を1行だけ書き、含む関係はサーバーで読むときに広げる（includes / has）。
const PRODUCTS=[
  {code:'text',name:'やさしいテキスト',price:2980,plan:'text',sale:true,start:Object.freeze({price:2480,lookupKey:'takken2027_text_start'})},
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
// ---- スタート価格の出し分け（値段・期間は仮置き。最終決定はKei。数字は台帳の start と下の既定だけ）----
// 開始のころの終わり（既定 2027-01-11 日本時間の終わり）までは全員。そのあとは、その人の登録の日（users.created_at）を1日目として7日目の終わりまで。
const DEFAULT_START_OPEN_UNTIL='2027-01-11T23:59:59+09:00';
const JST=9*3600000,DAY=86400000;
function startOpenUntil(){const t=Date.parse(process.env.START_PRICE_OPEN_UNTIL||'');return Number.isFinite(t)?t:Date.parse(DEFAULT_START_OPEN_UNTIL);}
const time=v=>{const t=v instanceof Date?v.getTime():typeof v==='number'?v:typeof v==='string'&&v?Date.parse(v):NaN;return Number.isFinite(t)?t:NaN;};
const jstDate=ms=>new Date(ms+JST).toISOString().slice(0,10);
// その日（日本時間）の終わりの直後＝翌日0:00 のミリ秒。
const jstDayEnd=date=>Date.parse(date+'T00:00:00+09:00')+DAY;
const plain=product=>({kind:'tsujo',price:product.price,listPrice:product.price,startPrice:null,until:null,basis:null,lookupKey:product.lookupKey});
// その人にいま効く値段。start の無い商品は常に通常。until は、いまの決まり（basis）でスタート価格が効く最後の日（日本時間）。
function offer(product,{now=Date.now(),registeredAt}={}){
  if(!product.start)return plain(product);
  const at=time(now),reg=time(registeredAt);
  const openEnd=Math.floor(startOpenUntil()/1000)*1000+1000; // 秒の終わりまで（23:59:59.999 も含む）
  const openDay=jstDate(startOpenUntil());
  const regLast=Number.isFinite(reg)?jstDate(reg+6*DAY):null; // 登録の日を1日目とした7日目の日付
  let basis=null;
  if(Number.isFinite(at)&&at<openEnd)basis='open';
  else if(Number.isFinite(at)&&regLast&&at<jstDayEnd(regLast))basis='touroku';
  if(!basis)return {...plain(product),startPrice:product.start.price};
  // 開始のころの間は、until は全員同じ日（開始のころの終わり）。そのあとも登録から7日目までなら、次に開いたとき basis が touroku に変わる。
  const until=basis==='open'?openDay:regLast;
  return {kind:'start',price:product.start.price,listPrice:product.price,startPrice:product.start.price,until,basis,lookupKey:product.start.lookupKey};
}
// いま売っている商品（台帳の sale:true）。環境変数 SHOW_ALL_PRODUCTS=1 なら全部。
const selling=p=>process.env.SHOW_ALL_PRODUCTS==='1'||p.sale===true;
const onSale=code=>{const p=find(code);return !!p&&selling(p);};
const saleProducts=()=>PRODUCTS.filter(selling);
module.exports={PRODUCTS,LEGACY_PLANS,GRANTABLE_PLANS,DEFAULT_START_OPEN_UNTIL,find,includes,has,expand,offer,startOpenUntil,jstDate,onSale,saleProducts};

