'use strict';
const s=require('../lib/server');
const stripe=require('../lib/stripe');
const products=require('../lib/products');
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
    success_url=origin+'/kounyu-test.html?checkout=ok&product='+product.code;
    cancel_url=origin+'/kounyu-test.html?checkout=cancel';
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
