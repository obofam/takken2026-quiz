// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
const s=require('./_lib/server');
const stripe=require('./_lib/stripe');
const products=require('./_lib/products');
const {runNudge}=require('./_lib/nudge');
// 売り場用：いま売っている商品の名前と値段、ログインの有無・持っている権利・スタート価格の出し分け・権利の最後の日。ログイン不要（cookie があれば中身が増えるだけ）。plan の中身・lookup_key は返さない。
// 商品は台帳の sale:true だけ（環境変数 SHOW_ALL_PRODUCTS=1 なら全部）。
// ?keepalive=1：試し用データベース（Supabase 無料枠）は使わない日が続くと休止する。毎日1回（vercel.json の crons）1行だけ読む。返すのは ok だけ。
module.exports=s.endpoint(['GET'],async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if((req.query?.keepalive??new URL(req.url||'/','http://localhost').searchParams.get('keepalive'))==='1'){
    const rows=await s.supabase('/rest/v1/users?select=id&limit=1');
    if(!Array.isArray(rows))s.fail(503,'database_unavailable');
    return res.status(200).json({ok:true});
  }
  // ?nudge=1：3週間以上記録があいた人へ LINE でひとこと（vercel.json の crons・本番だけ）。CRON_SECRET の Bearer が合うときだけ動く。返すのは人数と理由コードだけ。
  if((req.query?.nudge??new URL(req.url||'/','http://localhost').searchParams.get('nudge'))==='1'){
    const secret=process.env.CRON_SECRET;
    if(!secret||req.headers?.authorization!=='Bearer '+secret)s.fail(404,'not_found');
    return res.status(200).json(await runNudge({fetch:globalThis.fetch,env:process.env,now:Date.now()}));
  }
  // cookie が無い・不正・切れている・許可外は「ログインしていない」。401 にはしない。データベースの不調だけは 503 のまま。
  let current=null;
  if(s.cookies(req)[s.COOKIE]){
    try{current=await s.session(req);}
    catch(e){if(!(e instanceof s.HttpError)||![401,403].includes(e.status))throw e;}
  }
  let owned=[],registeredAt;
  if(current){
    const [granted,users]=await Promise.all([s.entitlements(current.userId),s.supabase('/rest/v1/users?'+new URLSearchParams({id:'eq.'+current.userId,select:'created_at'}))]);
    owned=products.expand(granted);
    registeredAt=Array.isArray(users)?users[0]?.created_at:undefined;
  }
  const now=Date.now();
  const offers=Object.fromEntries(products.PRODUCTS.filter(p=>p.start).map(p=>{const {kind,price,listPrice,startPrice,until,basis}=products.offer(p,{now,registeredAt});return [p.code,{kind,price,listPrice,startPrice,until,basis}];}));
  return res.status(200).json({
    products:products.saleProducts().map(p=>({code:p.code,name:p.name,price:p.price,plan:p.plan})),
    includes:Object.fromEntries(['zenbu','bansou'].map(p=>[p,products.includes(p)])),
    loggedIn:!!current,
    owned,
    offers,
    validUntil:products.jstDate(Date.parse(stripe.validUntil()))
  });
});
