'use strict';
const s=require('../lib/server');
const stripe=require('../lib/stripe');
// Stripe signs the raw bytes: the body must not be parsed before verification.
function skip(res,reason,session){
  // Fixed reason + Stripe's own session id only. Never log the payload or the exception.
  console.error('stripe_webhook_skipped',{reason,session:typeof session?.id==='string'?session.id.slice(0,80):null});
  return res.status(200).json({received:true,skipped:reason});
}
module.exports=s.endpoint(['POST'],async(req,res)=>{
  const signature=req.headers?.['stripe-signature'];
  if(typeof signature!=='string'||!signature)s.fail(400,'invalid_signature');
  const signingValue=stripe.webhookSigningValue();
  const payload=await stripe.rawBody(req);
  let event;
  try{event=stripe.client().webhooks.constructEvent(payload,signature,signingValue);}
  catch{s.fail(400,'invalid_signature');}
  if(event.type!=='checkout.session.completed')return res.status(200).json({received:true});
  const session=event.data?.object;
  if(session?.payment_status!=='paid')return res.status(200).json({received:true});
  const userId=session.metadata?.userId;
  if(typeof session.id!=='string'||!session.id.startsWith('cs_')||typeof event.id!=='string'||!event.id)return skip(res,'malformed_event',session);
  if(typeof userId!=='string'||!s.UUID.test(userId)||session.client_reference_id!==userId||session.metadata?.plan!=='ume')return skip(res,'metadata_missing',session);
  const result=await s.supabase('/rest/v1/rpc/grant_entitlement',{method:'POST',body:{p_user_id:userId,p_plan:'ume',p_valid_until:stripe.validUntil(),p_source:'stripe:'+session.id,p_event_id:event.id}});
  if(result==='unknown_user')return skip(res,'unknown_user',session);
  if(!['granted','duplicate'].includes(result))s.fail(503,'database_unavailable');
  return res.status(200).json({received:true,result});
});
module.exports.config={api:{bodyParser:false}};
