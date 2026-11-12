'use strict';
const s=require('../lib/server');
const products=require('../lib/products');
// 購入テストページ用：商品の名前と値段だけ返す（plan・lookup_key は返さない）。ログイン不要・秘密なし。
module.exports=s.endpoint(['GET'],async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({products:products.PRODUCTS.map(p=>({code:p.code,name:p.name,price:p.price,plan:p.plan})),includes:Object.fromEntries(['zenbu','bansou'].map(p=>[p,products.includes(p)]))});
});
