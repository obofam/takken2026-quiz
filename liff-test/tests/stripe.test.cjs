'use strict';
const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const Stripe=require('stripe');
const s=require('../lib/server');
const stripeLib=require('../lib/stripe');
const checkoutApi=require('../api/checkout');
const webhookApi=require('../api/stripe-webhook');
const sessionApi=require('../api/session');
const originalFetch=global.fetch,originalEnv={...process.env},originalError=console.error;
const user='12345678-1234-4123-8123-123456789abc',other='87654321-1234-4123-8123-123456789abc';
const address='tester@example.com';
const webhookSigningValue='whsec_test_only_value';
const realStripe=new Stripe('sk_test_dummy_not_a_real_key');
beforeEach(()=>{
  Object.assign(process.env,{SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only',STRIPE_PRICE_KARTE:'price_test_123',STRIPE_WEBHOOK_SECRET:webhookSigningValue});
  delete process.env.ENTITLEMENT_VALID_UNTIL;delete process.env.STRIPE_SECRET_KEY;
  stripeLib.setClient(null);console.error=originalError;
  global.fetch=async()=>{throw Error('unmocked fetch');};
});
after(()=>{global.fetch=originalFetch;process.env=originalEnv;stripeLib.setClient(null);console.error=originalError;});
function response(){const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
const cookie=(id=user)=>s.COOKIE+'='+s.sign({purpose:'session',userId:id,provider:'email',subject:address,exp:Date.now()/1000+600});
function checkoutRequest(patch={},body={}){return {method:'POST',url:'/api/checkout',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json','x-mimiobo-user':user,cookie:cookie(),...patch},body};}
function authenticated(run){global.fetch=async(url,options)=>{const u=new URL(url),body=options?.body?JSON.parse(options.body):undefined;let data;
  if(u.pathname==='/rest/v1/allowlist')data=[{provider:'email'}];else if(u.pathname==='/rest/v1/identities')data=[{user_id:user}];else data=await run(u,options,body);
  return {ok:true,status:200,json:async()=>data};};}
function fakeCheckout(){const calls=[];return {calls,checkout:{sessions:{create:async params=>{calls.push(params);return {id:'cs_test_abc',url:'https://checkout.stripe.com/c/pay/cs_test_abc'};}}}};}

test('checkout requires a logged-in session, same origin and the current user header',async()=>{
  const fake=fakeCheckout();stripeLib.setClient(fake);
  authenticated(()=>assert.fail('no database write expected'));
  let res=response();await checkoutApi(checkoutRequest({cookie:undefined}),res);assert.equal(res.code,401);
  res=response();await checkoutApi(checkoutRequest({origin:'https://attacker.example'}),res);assert.equal(res.code,403);
  res=response();await checkoutApi(checkoutRequest({'x-mimiobo-user':other}),res);assert.equal(res.code,401);assert.equal(res.data.error,'user_changed');
  res=response();await checkoutApi(checkoutRequest({'x-mimiobo-user':undefined}),res);assert.equal(res.code,401);
  res=response();await checkoutApi({...checkoutRequest(),method:'GET'},res);assert.equal(res.code,405);
  assert.equal(fake.calls.length,0);
});
test('checkout creates a hosted test-mode payment bound to the user and returns only the URL',async()=>{
  const fake=fakeCheckout();stripeLib.setClient(fake);authenticated(()=>assert.fail('unexpected query'));
  const res=response();await checkoutApi(checkoutRequest(),res);
  assert.equal(res.code,200);assert.deepEqual(res.data,{url:'https://checkout.stripe.com/c/pay/cs_test_abc'});
  assert.equal(fake.calls.length,1);
  assert.deepEqual(fake.calls[0],{
    mode:'payment',client_reference_id:user,metadata:{userId:user,plan:'ume'},
    line_items:[{price:'price_test_123',quantity:1}],
    success_url:'http://localhost:3000/karte.html?checkout=ok&session_id={CHECKOUT_SESSION_ID}',
    cancel_url:'http://localhost:3000/ep10-preview.html?checkout=cancel'
  });
});
test('checkout uses the approved HTTPS host for URLs on the hosted site',async()=>{
  const fake=fakeCheckout();stripeLib.setClient(fake);authenticated(()=>assert.fail('unexpected query'));
  const res=response();await checkoutApi(checkoutRequest({host:'mimiobo-liff-test.vercel.app',origin:'https://mimiobo-liff-test.vercel.app'}),res);
  assert.equal(res.code,200);
  assert.equal(fake.calls[0].success_url,'https://mimiobo-liff-test.vercel.app/karte.html?checkout=ok&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(fake.calls[0].cancel_url,'https://mimiobo-liff-test.vercel.app/ep10-preview.html?checkout=cancel');
});
test('checkout fails closed without a test key or price, and never returns a non-HTTPS URL',async()=>{
  authenticated(()=>assert.fail('unexpected query'));
  // No injected client: the key comes from the environment and must be a test key.
  for(const key of [undefined,'sk_live_not_allowed','garbage']){
    if(key===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=key;
    const res=response();await checkoutApi(checkoutRequest(),res);
    assert.equal(res.code,503);assert.equal(res.data.error,'payment_not_configured');
  }
  stripeLib.setClient(fakeCheckout());
  for(const price of [undefined,'','prod_wrong','price_bad value']){
    if(price===undefined)delete process.env.STRIPE_PRICE_KARTE;else process.env.STRIPE_PRICE_KARTE=price;
    const res=response();await checkoutApi(checkoutRequest(),res);assert.equal(res.code,503);assert.equal(res.data.error,'payment_not_configured');
  }
  process.env.STRIPE_PRICE_KARTE='price_test_123';
  stripeLib.setClient({checkout:{sessions:{create:async()=>({url:'javascript:alert(1)'})}}});
  const res=response();await checkoutApi(checkoutRequest(),res);assert.equal(res.code,503);assert.equal(res.data.error,'payment_unavailable');
});
test('a Stripe API failure becomes a generic 503 without leaking the upstream message',async()=>{
  authenticated(()=>assert.fail('unexpected query'));
  stripeLib.setClient({checkout:{sessions:{create:async()=>{throw Object.assign(new Error('sk_test_secret in message'),{name:'StripeError'});}}}});
  const logs=[];console.error=(...args)=>logs.push(args);
  const res=response();await checkoutApi(checkoutRequest(),res);
  assert.equal(res.code,503);assert.deepEqual(res.data,{error:'service_unavailable'});
  assert.doesNotMatch(JSON.stringify(logs),/sk_test_secret/);
});

// ---- webhook ----
const event=(over={},sessionOver={})=>({id:'evt_test_1',object:'event',type:'checkout.session.completed',data:{object:{id:'cs_test_abc',object:'checkout.session',payment_status:'paid',client_reference_id:user,metadata:{userId:user,plan:'ume'},...sessionOver}},...over});
const sign=(payload,signingValue=webhookSigningValue,timestamp)=>realStripe.webhooks.generateTestHeaderString({payload,secret:signingValue,...(timestamp?{timestamp}:{})});
function webhookRequest(payload,header=sign(payload),{stream=false}={}){
  const buffer=Buffer.from(payload);
  // A parsed body is deliberately wrong: the handler must verify the raw bytes only.
  const headers={'stripe-signature':header,'content-type':'application/json'};
  if(stream)return Object.assign(Readable.from([buffer.subarray(0,10),buffer.subarray(10)]),{method:'POST',headers,body:{parsed:true}});
  return {method:'POST',headers,rawBody:buffer,body:{parsed:true}};
}
function grantMock(results,rpcCalls=[]){
  stripeLib.setClient(realStripe);
  global.fetch=async(url,options)=>{
    const u=new URL(url);assert.equal(u.pathname,'/rest/v1/rpc/grant_entitlement');
    const body=JSON.parse(options.body);rpcCalls.push(body);
    const result=typeof results==='function'?results(body):results;
    return {ok:true,status:200,json:async()=>result};
  };
  return rpcCalls;
}
test('webhook verifies the signature over the raw body and rejects forged, stale, missing or mis-keyed requests',async()=>{
  stripeLib.setClient(realStripe);global.fetch=async()=>assert.fail('no database call expected');
  const payload=JSON.stringify(event());
  const cases=[
    ['wrong signing value',webhookRequest(payload,sign(payload,'whsec_other'))],
    ['tampered payload',webhookRequest(payload+' ',sign(payload))],
    ['stale timestamp',webhookRequest(payload,sign(payload,webhookSigningValue,Math.floor(Date.now()/1000)-3600))],
    ['garbage header',webhookRequest(payload,'garbage')],
    ['missing header',{...webhookRequest(payload),headers:{}}]
  ];
  for(const [name,req] of cases){const res=response();await webhookApi(req,res);assert.equal(res.code,400,name);assert.equal(res.data.error,'invalid_signature',name);}
  // Re-serialised JSON of the same event is a different byte string, so the signature must fail.
  const reordered=JSON.stringify(JSON.parse(payload),null,2);
  const res=response();await webhookApi(webhookRequest(reordered,sign(payload)),res);assert.equal(res.code,400);
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const missing=response();await webhookApi(webhookRequest(payload),missing);assert.equal(missing.code,503);assert.equal(missing.data.error,'webhook_not_configured');
});
test('webhook rejects non-POST methods',async()=>{
  const res=response();await webhookApi({method:'GET',headers:{}},res);assert.equal(res.code,405);
});
test('paid checkout.session.completed grants one learning-karte entitlement, read from a raw stream or buffer',async()=>{
  for(const stream of [false,true]){
    const calls=grantMock('granted');
    const payload=JSON.stringify(event());
    const res=response();await webhookApi(webhookRequest(payload,sign(payload),{stream}),res);
    assert.equal(res.code,200);assert.deepEqual(res.data,{received:true,result:'granted'});
    assert.deepEqual(calls,[{p_user_id:user,p_plan:'ume',p_valid_until:'2027-10-17T14:59:59.000Z',p_source:'stripe:cs_test_abc',p_event_id:'evt_test_1'}]);
  }
});
test('redelivery of the same payment is acknowledged and keyed to the same source (idempotent)',async()=>{
  const sources=new Set(),rows=[];
  const calls=grantMock(body=>{const fresh=!sources.has(body.p_source);sources.add(body.p_source);if(fresh)rows.push(body);return fresh?'granted':'duplicate';});
  const first=JSON.stringify(event()),retry=JSON.stringify(event({id:'evt_test_2'}));
  const results=[];
  for(const payload of [first,first,retry]){const res=response();await webhookApi(webhookRequest(payload),res);assert.equal(res.code,200);results.push(res.data.result);}
  assert.deepEqual(results,['granted','duplicate','duplicate']);
  assert.equal(rows.length,1);assert.equal(calls.length,3);
  assert.deepEqual([...new Set(calls.map(c=>c.p_source))],['stripe:cs_test_abc']);
  // A different payment (new session) is a new entitlement source.
  const next=JSON.stringify(event({id:'evt_test_3'},{id:'cs_test_def'}));
  const res=response();await webhookApi(webhookRequest(next),res);assert.equal(res.data.result,'granted');assert.equal(rows.length,2);
});
test('valid_until comes from ENTITLEMENT_VALID_UNTIL, defaulting to the 2027 exam day; an invalid value fails closed',async()=>{
  const calls=grantMock('granted');
  process.env.ENTITLEMENT_VALID_UNTIL='2028-10-15T23:59:59+09:00';
  const payload=JSON.stringify(event());
  let res=response();await webhookApi(webhookRequest(payload),res);assert.equal(res.code,200);
  assert.equal(calls[0].p_valid_until,'2028-10-15T14:59:59.000Z');
  process.env.ENTITLEMENT_VALID_UNTIL='not a date';
  res=response();await webhookApi(webhookRequest(payload),res);assert.equal(res.code,503);assert.equal(res.data.error,'entitlement_not_configured');
  assert.equal(calls.length,1);
});
test('only paid checkout.session.completed events write; everything else is acknowledged without a database call',async()=>{
  stripeLib.setClient(realStripe);global.fetch=async()=>assert.fail('no database call expected');
  const payloads=[
    JSON.stringify(event({},{payment_status:'unpaid'})),
    JSON.stringify(event({},{payment_status:'no_payment_required'})),
    JSON.stringify(event({type:'checkout.session.expired'})),
    JSON.stringify(event({type:'payment_intent.succeeded'}))
  ];
  for(const payload of payloads){const res=response();await webhookApi(webhookRequest(payload),res);assert.equal(res.code,200);assert.deepEqual(res.data,{received:true});}
});
test('missing, mismatched or unsupported metadata is acknowledged with 200 and a fixed log line, never granted',async()=>{
  stripeLib.setClient(realStripe);global.fetch=async()=>assert.fail('no database call expected');
  const logs=[];console.error=(...args)=>logs.push(args);
  const bad=[
    {metadata:{}},{metadata:{userId:'not-a-uuid',plan:'ume'},client_reference_id:'not-a-uuid'},
    {metadata:{userId:user,plan:'take'}},{metadata:{userId:user,plan:'ume'},client_reference_id:other},
    {metadata:{userId:user,plan:'ume'},client_reference_id:null},{metadata:null}
  ];
  for(const patch of bad){const res=response();await webhookApi(webhookRequest(JSON.stringify(event({},patch))),res);assert.equal(res.code,200);assert.deepEqual(res.data,{received:true,skipped:'metadata_missing'});}
  const res=response();await webhookApi(webhookRequest(JSON.stringify(event({},{id:'not_a_session'}))),res);assert.equal(res.code,200);assert.equal(res.data.skipped,'malformed_event');
  assert.equal(logs.length,bad.length+1);
  for(const entry of logs)assert.deepEqual(Object.keys(entry[1]).sort(),['reason','session']);
  assert.doesNotMatch(JSON.stringify(logs),new RegExp(user));
});
test('an unknown user is acknowledged with 200 and logged; a database outage returns 503 so Stripe retries',async()=>{
  const logs=[];console.error=(...args)=>logs.push(args);
  grantMock('unknown_user');
  const payload=JSON.stringify(event());
  let res=response();await webhookApi(webhookRequest(payload),res);
  assert.equal(res.code,200);assert.deepEqual(res.data,{received:true,skipped:'unknown_user'});
  assert.deepEqual(logs,[['stripe_webhook_skipped',{reason:'unknown_user',session:'cs_test_abc'}]]);
  stripeLib.setClient(realStripe);
  global.fetch=async()=>({ok:false,status:500,json:async()=>({message:'private details'})});
  res=response();await webhookApi(webhookRequest(payload),res);assert.equal(res.code,503);assert.deepEqual(res.data,{error:'database_unavailable'});
  grantMock('something_else');
  res=response();await webhookApi(webhookRequest(payload),res);assert.equal(res.code,503);
});
test('webhook endpoint opts out of body parsing so Vercel hands over the raw stream',()=>{
  assert.deepEqual(webhookApi.config,{api:{bodyParser:false}});
});
test('oversized webhook bodies are refused before verification',async()=>{
  stripeLib.setClient(realStripe);
  const req=Object.assign(Readable.from([Buffer.alloc(600000),Buffer.alloc(600000)]),{method:'POST',headers:{'stripe-signature':'t=1,v1=x'}});
  const res=response();await webhookApi(req,res);assert.equal(res.code,413);
});

test('local dev harness serves karte.html, registers both payment endpoints and passes the webhook a raw Buffer',()=>{
  const dev=require('node:fs').readFileSync(require('node:path').join(__dirname,'../scripts/dev.cjs'),'utf8');
  assert.match(dev,/'karte\.html'/);assert.match(dev,/'checkout','stripe-webhook'/);
  assert.match(dev,/pathname==='\/api\/stripe-webhook'[\s\S]*req\.rawBody=Buffer\.concat/);
  assert.doesNotMatch(dev,/server=1/);
});

// ---- session entitlements ----
function sessionRequest(){return {method:'GET',url:'/api/session',headers:{host:'localhost:3000',cookie:cookie()}};}
test('GET session returns only live entitlements for the authenticated user (server-side decision)',async()=>{
  let seen;
  authenticated(u=>{
    if(u.pathname==='/rest/v1/entitlements'){seen=u;return [
      {plan:'ume',valid_until:'2999-01-01T00:00:00+00:00'},
      {plan:'take',valid_until:null},
      {plan:'matsu',valid_until:'2000-01-01T00:00:00+00:00'},
      {plan:'karte',valid_until:null},
      {plan:'ume',valid_until:'2999-01-01T00:00:00+00:00',user_id:other,source:'stripe:private'}
    ];}
    return [{provider:'email'}];
  });
  const res=response();await sessionApi(sessionRequest(),res);
  assert.equal(res.code,200);
  assert.equal(seen.searchParams.get('user_id'),'eq.'+user);
  assert.match(seen.searchParams.get('or'),/^\(valid_until\.is\.null,valid_until\.gt\.\d{4}-\d\d-\d\dT[\d:.]+Z\)$/);
  assert.deepEqual(res.data.entitlements,[{plan:'ume',valid_until:'2999-01-01T00:00:00+00:00'},{plan:'take',valid_until:null},{plan:'ume',valid_until:'2999-01-01T00:00:00+00:00'}]);
  assert.doesNotMatch(JSON.stringify(res.data),/stripe:private|source|user_id/);
});
test('GET session without any entitlement returns an empty list; a malformed or failing entitlements query fails closed',async()=>{
  authenticated(u=>u.pathname==='/rest/v1/entitlements'?[]:[{provider:'email'}]);
  let res=response();await sessionApi(sessionRequest(),res);assert.equal(res.code,200);assert.deepEqual(res.data.entitlements,[]);
  authenticated(u=>u.pathname==='/rest/v1/entitlements'?null:[{provider:'email'}]);
  res=response();await sessionApi(sessionRequest(),res);assert.equal(res.code,503);assert.equal(res.data.entitlements,undefined);
  global.fetch=async url=>{const u=new URL(url);
    if(u.pathname==='/rest/v1/entitlements')return {ok:false,status:500,json:async()=>({message:'private'})};
    return {ok:true,status:200,json:async()=>u.pathname==='/rest/v1/allowlist'?[{provider:'email'}]:u.searchParams.get('select')==='provider'?[{provider:'email'}]:[{user_id:user}]};};
  res=response();await sessionApi(sessionRequest(),res);assert.equal(res.code,503);assert.deepEqual(res.data,{error:'database_unavailable'});
});
