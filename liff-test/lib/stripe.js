'use strict';
// Stripe helpers. Test mode only: live keys are refused. The client can be injected for tests.
const s=require('./server');
const DEFAULT_VALID_UNTIL='2027-10-17T23:59:59+09:00';
let injected=null;
function setClient(client){injected=client;}
function client(){
  if(injected)return injected;
  const key=process.env.STRIPE_SECRET_KEY;
  if(typeof key!=='string'||!/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(key))s.fail(503,'payment_not_configured');
  injected=new (require('stripe'))(key,{maxNetworkRetries:1,timeout:10000});
  return injected;
}
function price(){const id=process.env.STRIPE_PRICE_KARTE;if(typeof id!=='string'||!/^price_[A-Za-z0-9_]+$/.test(id))s.fail(503,'payment_not_configured');return id;}
function webhookSigningValue(){const v=process.env.STRIPE_WEBHOOK_SECRET;if(typeof v!=='string'||!/^whsec_\S+$/.test(v))s.fail(503,'webhook_not_configured');return v;}
// Valid-until is configuration, not a constant: "until this year's exam" changes each season.
function validUntil(){
  const value=process.env.ENTITLEMENT_VALID_UNTIL||DEFAULT_VALID_UNTIL;
  const time=Date.parse(value);
  if(!Number.isFinite(time))s.fail(503,'entitlement_not_configured');
  return new Date(time).toISOString();
}
async function rawBody(req,limit=1000000){
  if(Buffer.isBuffer(req.rawBody)||typeof req.rawBody==='string')return req.rawBody;
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)s.fail(413,'body_too_large');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
module.exports={DEFAULT_VALID_UNTIL,setClient,client,price,webhookSigningValue,validUntil,rawBody};
