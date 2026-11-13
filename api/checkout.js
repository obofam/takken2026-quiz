// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
const s=require('./_lib/server');
const stripe=require('./_lib/stripe');
const products=require('./_lib/products');
// Starts a Stripe Checkout (hosted, test mode). Only the Checkout URL goes back to the browser.
// Body {product:"<code>"} picks a 2027 product from lib/products.js (price found by lookup_key). No product = the learning karte (plan ume), as before.
module.exports=s.endpoint(['POST'],async(req,res)=>{
  s.mutation(req);
  const current=await s.session(req);
  if(req.headers?.['x-mimiobo-user']!==current.userId)s.fail(401,'user_changed');
  const origin=s.origin(req);
  const requested=req.body.product;
  let metadata,price,success_url,cancel_url;
  if(requested===undefined){
    metadata={userId:current.userId,plan:'ume'};
    price=stripe.price();
    // {CHECKOUT_SESSION_ID} is a Stripe placeholder and must stay literal.
    success_url=origin+'/karte.html?checkout=ok&session_id={CHECKOUT_SESSION_ID}';
    cancel_url=origin+'/ep10-preview.html?checkout=cancel';
  }else{
    const product=typeof requested==='string'?products.find(requested):null;
    if(!product)s.fail(400,'invalid_product');
    price=await stripe.priceByLookupKey(product.lookupKey);
    metadata={userId:current.userId,plan:product.plan,product:product.code};
    // 戻り先のページ。本番の購入ページを作ったら環境変数 CHECKOUT_RETURN_PATH（例 /kounyu.html）で指す。未設定は試し用のページ。
    const back=/^\/[A-Za-z0-9._\/-]*$/.test(process.env.CHECKOUT_RETURN_PATH||'')&&!process.env.CHECKOUT_RETURN_PATH.includes('//')?process.env.CHECKOUT_RETURN_PATH:'/kounyu-test.html';
    success_url=origin+back+'?checkout=ok&product='+product.code;
    cancel_url=origin+back+'?checkout=cancel';
  }
  const checkout=await stripe.client().checkout.sessions.create({
    mode:'payment',
    client_reference_id:current.userId,
    metadata,
    line_items:[{price,quantity:1}],
    success_url,
    cancel_url
  });
  if(typeof checkout?.url!=='string'||!/^https:\/\//.test(checkout.url))s.fail(503,'payment_unavailable');
  return res.status(200).json({url:checkout.url});
});
