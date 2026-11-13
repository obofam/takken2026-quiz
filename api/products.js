// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
const s=require('./_lib/server');
const products=require('./_lib/products');
// 購入テストページ用：商品の名前と値段だけ返す（plan・lookup_key は返さない）。ログイン不要・秘密なし。
// ?keepalive=1：試し用データベース（Supabase 無料枠）は使わない日が続くと休止する。毎日1回（vercel.json の crons）1行だけ読む。返すのは ok だけ。
module.exports=s.endpoint(['GET'],async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if((req.query?.keepalive??new URL(req.url||'/','http://localhost').searchParams.get('keepalive'))==='1'){
    const rows=await s.supabase('/rest/v1/users?select=id&limit=1');
    if(!Array.isArray(rows))s.fail(503,'database_unavailable');
    return res.status(200).json({ok:true});
  }
  return res.status(200).json({products:products.PRODUCTS.map(p=>({code:p.code,name:p.name,price:p.price,plan:p.plan})),includes:Object.fromEntries(['zenbu','bansou'].map(p=>[p,products.includes(p)]))});
});
