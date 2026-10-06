'use strict';
const s=require('../lib/server');
const stripe=require('../lib/stripe');
// Starts a Stripe Checkout (hosted, test mode). Only the Checkout URL goes back to the browser.
module.exports=s.endpoint(['POST'],async(req,res)=>{
  s.mutation(req);
  const current=await s.session(req);
  if(req.headers?.['x-mimiobo-user']!==current.userId)s.fail(401,'user_changed');
  const origin=s.origin(req);
  const checkout=await stripe.client().checkout.sessions.create({
    mode:'payment',
    client_reference_id:current.userId,
    metadata:{userId:current.userId,plan:'ume'},
    line_items:[{price:stripe.price(),quantity:1}],
    // {CHECKOUT_SESSION_ID} is a Stripe placeholder and must stay literal.
    success_url:origin+'/karte.html?checkout=ok&session_id={CHECKOUT_SESSION_ID}',
    cancel_url:origin+'/ep10-preview.html?checkout=cancel'
  });
  if(typeof checkout?.url!=='string'||!/^https:\/\//.test(checkout.url))s.fail(503,'payment_unavailable');
  return res.status(200).json({url:checkout.url});
});
