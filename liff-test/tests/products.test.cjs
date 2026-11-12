'use strict';
// 2027の商品：台帳・checkout・webhook・ep-text・karte・マイグレーション。Stripe と Supabase は呼ばない。
const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Stripe=require('stripe');
const {PGlite}=require('@electric-sql/pglite');
const s=require('../lib/server');
const stripeLib=require('../lib/stripe');
const products=require('../lib/products');
const checkoutApi=require('../api/checkout');
const webhookApi=require('../api/stripe-webhook');
const productsApi=require('../api/products');
const textApi=require('../api/ep-text');
const karteApi=require('../api/karte');
const originalFetch=global.fetch,originalEnv={...process.env},originalError=console.error;
const user='12345678-1234-4123-8123-123456789abc';
const address='tester@example.com';
const whsec='whsec_test_only_value';
const realStripe=new Stripe('sk_test_dummy_not_a_real_key');
beforeEach(()=>{
  Object.assign(process.env,{SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only',STRIPE_PRICE_KARTE:'price_test_123',STRIPE_WEBHOOK_SECRET:whsec});
  delete process.env.STRIPE_SECRET_KEY;delete process.env.ENTITLEMENT_VALID_UNTIL;delete process.env.ALLOW_TEXT_PREVIEW;
  stripeLib.setClient(null);console.error=originalError;
  global.fetch=async()=>{throw Error('unmocked fetch');};
});
after(()=>{global.fetch=originalFetch;process.env=originalEnv;stripeLib.setClient(null);console.error=originalError;});
function response(){const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
const cookie=()=>s.COOKIE+'='+s.sign({purpose:'session',userId:user,provider:'email',subject:address,exp:Date.now()/1000+600});
function database(entitlements){
  global.fetch=async url=>{const u=new URL(url);let data;
    if(u.pathname==='/rest/v1/allowlist')data=[{provider:'email'}];
    else if(u.pathname==='/rest/v1/identities')data=[{user_id:user}];
    else if(u.pathname==='/rest/v1/entitlements')data=entitlements;
    else if(u.pathname==='/rest/v1/answers')data=[];
    else assert.fail('unexpected query '+u.pathname);
    return {ok:true,status:200,json:async()=>data};};
}
const ent=plan=>[{plan,valid_until:null}];

// ---- 台帳 ----
test('ledger: 8 products with plan, price and lookup_key takken2027_<code>',()=>{
  assert.deepEqual(products.PRODUCTS.map(p=>[p.code,p.price,p.plan,p.lookupKey]),[
    ['text',2980,'text','takken2027_text'],['haru8',4980,'haru','takken2027_haru8'],['natsu8',5980,'natsu','takken2027_natsu8'],
    ['last30',9800,'last30','takken2027_last30'],['last30_hayawari',8800,'last30','takken2027_last30_hayawari'],
    ['zenbu',19800,'zenbu','takken2027_zenbu'],['bansou',39800,'bansou','takken2027_bansou'],['bansou_1ki',10000,'bansou','takken2027_bansou_1ki']]);
  assert.equal(products.find('nope'),null);
});
test('ledger: includes() and has() expand zenbu and bansou, expired rights do not count',()=>{
  assert.deepEqual(products.includes('text'),['text']);
  assert.deepEqual(products.includes('zenbu').sort(),['haru','last30','matome','natsu','text','zenbu']);
  assert.deepEqual(products.includes('bansou').sort(),['bansou','haru','last30','matome','natsu','text','zenbu']);
  for(const p of ['text','haru','natsu','last30','matome','zenbu']){assert.equal(products.has(ent('zenbu'),p),true,p);assert.equal(products.has(ent('bansou'),p),true,p);}
  assert.equal(products.has(ent('zenbu'),'bansou'),false);
  assert.equal(products.has(ent('haru'),'text'),false);
  assert.equal(products.has(ent('ume'),'text'),false);
  assert.equal(products.has([{plan:'zenbu',valid_until:'2000-01-01T00:00:00+00:00'}],'text'),false);
  assert.equal(products.has([],'text'),false);
});
test('GET /api/products returns names and prices only (no lookup_key)',async()=>{
  const res=response();await productsApi({method:'GET',headers:{host:'localhost:3000'}},res);
  assert.equal(res.code,200);assert.equal(res.data.products.length,8);
  assert.doesNotMatch(JSON.stringify(res.data),/lookup|takken2027_/);
});
test('entitlements() returns the new plans too',async()=>{
  database([{plan:'zenbu',valid_until:null},{plan:'haru',valid_until:null},{plan:'bogus',valid_until:null}]);
  assert.deepEqual((await s.entitlements(user)).map(e=>e.plan),['zenbu','haru']);
});

// ---- checkout ----
function checkoutRequest(body){return {method:'POST',url:'/api/checkout',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json','x-mimiobo-user':user,cookie:cookie()},body};}
function fakeStripe({prices={}}={}){
  const calls=[],lookups=[];
  return {calls,lookups,
    prices:{list:async p=>{lookups.push(p);const id=prices[p.lookup_keys[0]];return {data:id?[{id}]:[]};}},
    checkout:{sessions:{create:async p=>{calls.push(p);return {id:'cs_test_abc',url:'https://checkout.stripe.com/c/pay/cs_test_abc'};}}}};
}
test('checkout per product: metadata, lookup_key and URLs',async()=>{
  const prices=Object.fromEntries(products.PRODUCTS.map(p=>[p.lookupKey,'price_'+p.code]));
  const fake=fakeStripe({prices});stripeLib.setClient(fake);database([]);
  for(const p of products.PRODUCTS){
    const res=response();await checkoutApi(checkoutRequest({product:p.code}),res);
    assert.equal(res.code,200,p.code);assert.deepEqual(res.data,{url:'https://checkout.stripe.com/c/pay/cs_test_abc'});
    const call=fake.calls.at(-1);
    assert.deepEqual(fake.lookups.at(-1),{lookup_keys:[p.lookupKey],active:true,limit:1});
    assert.deepEqual(call,{mode:'payment',client_reference_id:user,metadata:{userId:user,plan:p.plan,product:p.code},
      line_items:[{price:'price_'+p.code,quantity:1}],
      success_url:'http://localhost:3000/kounyu-test.html?checkout=ok&product='+p.code,cancel_url:'http://localhost:3000/kounyu-test.html?checkout=cancel'});
  }
});
test('checkout: unknown product is 400 invalid_product, missing price is 503, no product keeps the karte behaviour',async()=>{
  const fake=fakeStripe();stripeLib.setClient(fake);database([]);
  for(const product of ['nope',123,null,{},'ume','__proto__']){
    const res=response();await checkoutApi(checkoutRequest({product}),res);
    assert.equal(res.code,400,String(product));assert.deepEqual(res.data,{error:'invalid_product'});
  }
  let res=response();await checkoutApi(checkoutRequest({product:'text'}),res);
  assert.equal(res.code,503);assert.deepEqual(res.data,{error:'payment_not_configured'});
  assert.equal(fake.calls.length,0);
  const lookupsBefore=fake.lookups.length;
  res=response();await checkoutApi(checkoutRequest({}),res);
  assert.equal(res.code,200);assert.equal(fake.lookups.length,lookupsBefore,'no lookup for the karte');
  assert.deepEqual(fake.calls[0].metadata,{userId:user,plan:'ume'});
  assert.equal(fake.calls[0].line_items[0].price,'price_test_123');
  assert.equal(fake.calls[0].success_url,'http://localhost:3000/karte.html?checkout=ok&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(fake.calls[0].cancel_url,'http://localhost:3000/ep10-preview.html?checkout=cancel');
});
test('checkout: a price lookup failure and a live key are both payment_not_configured',async()=>{
  database([]);
  stripeLib.setClient({prices:{list:async()=>{throw Error('boom');}},checkout:{sessions:{create:async()=>assert.fail('no')}}});
  let res=response();await checkoutApi(checkoutRequest({product:'text'}),res);assert.equal(res.code,503);assert.equal(res.data.error,'payment_not_configured');
  stripeLib.setClient(null);process.env.STRIPE_SECRET_KEY='sk_live_not_allowed';
  res=response();await checkoutApi(checkoutRequest({product:'text'}),res);assert.equal(res.code,503);assert.equal(res.data.error,'payment_not_configured');
});

// ---- webhook ----
const event=(sessionOver={},over={})=>({id:'evt_test_1',object:'event',type:'checkout.session.completed',data:{object:{id:'cs_test_abc',object:'checkout.session',payment_status:'paid',client_reference_id:user,metadata:{userId:user,plan:'ume'},...sessionOver}},...over});
const sign=payload=>realStripe.webhooks.generateTestHeaderString({payload,secret:whsec});
function webhook(payload){return {method:'POST',headers:{'stripe-signature':sign(payload),'content-type':'application/json'},rawBody:Buffer.from(payload),body:{parsed:true}};}
function grantMock(calls){stripeLib.setClient(realStripe);global.fetch=async(url,options)=>{assert.equal(new URL(url).pathname,'/rest/v1/rpc/grant_entitlement');calls.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>'granted'};};}
test('webhook grants the plan of each product',async()=>{
  for(const p of products.PRODUCTS){
    const calls=[];grantMock(calls);
    const res=response();await webhookApi(webhook(JSON.stringify(event({metadata:{userId:user,plan:p.plan,product:p.code}}))),res);
    assert.equal(res.code,200,p.code);assert.deepEqual(res.data,{received:true,result:'granted'});
    assert.equal(calls.length,1);assert.equal(calls[0].p_plan,p.plan);assert.equal(calls[0].p_source,'stripe:cs_test_abc');
  }
  const calls=[];grantMock(calls);
  const res=response();await webhookApi(webhook(JSON.stringify(event({metadata:{userId:user,plan:'zenbu'}}))),res);
  assert.equal(calls[0].p_plan,'zenbu','plan without product is accepted when it is in the ledger');
});
test('webhook skips a product/plan mismatch, an unknown product, and matome or legacy take/matsu',async()=>{
  stripeLib.setClient(realStripe);global.fetch=async()=>assert.fail('no database call expected');
  console.error=()=>{};
  const bad=[{plan:'zenbu',product:'text'},{plan:'text',product:'zenbu'},{plan:'text',product:'nope'},{plan:'bansou',product:123},{plan:'matome'},{plan:'matome',product:'zenbu'},{plan:'take'},{plan:'matsu'},{plan:'bogus'}];
  for(const m of bad){
    const res=response();await webhookApi(webhook(JSON.stringify(event({metadata:{userId:user,...m}}))),res);
    assert.equal(res.code,200,JSON.stringify(m));assert.deepEqual(res.data,{received:true,skipped:'metadata_missing'});
  }
});

// ---- ep-text / karte ----
const textReq=()=>({method:'GET',url:'/api/ep-text?ep=1',headers:{host:'localhost:3000',cookie:cookie()}});
const karteReq=()=>({method:'GET',url:'/api/karte',headers:{host:'localhost:3000',cookie:cookie()}});
test('ep-text: text, zenbu and bansou get 200; haru, natsu, last30 alone get 403',async()=>{
  for(const [plan,code] of [['text',200],['zenbu',200],['bansou',200],['haru',403],['natsu',403],['last30',403],['ume',403]]){
    database(ent(plan));const res=response();await textApi(textReq(),res);assert.equal(res.code,code,plan);
  }
});
test('karte: ume/take/matsu/zenbu/bansou pass; text, haru, natsu, last30 alone do not',async()=>{
  for(const [plan,code] of [['ume',200],['take',200],['matsu',200],['zenbu',200],['bansou',200],['text',403],['haru',403],['natsu',403],['last30',403]]){
    database(ent(plan));const res=response();await karteApi(karteReq(),res);assert.equal(res.code,code,plan);
  }
});

// ---- マイグレーション ----
test('migration 202611120001 accepts the new plans, still refuses matome, keeps the old plans',async()=>{
  const db=new PGlite(),root=path.resolve(__dirname,'..');
  try{
    await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon, authenticated, service_role;");
    for(const f of ['202609170001_sprint1','202610060001_sprint2','202610060002_sprint4_catalog','202611110001_text_plan','202611120001_products_2027'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/'+f+'.sql'),'utf8'));
    await db.exec("insert into public.users(id) values ('00000000-0000-4000-8000-000000000020');");
    for(const plan of ['ume','take','matsu','text','haru','natsu','last30','zenbu','bansou']){
      const r=await db.query("select public.grant_entitlement('00000000-0000-4000-8000-000000000020',$1,null,'test:'||$1,'evt:'||$1) as r",[plan]);
      assert.equal(r.rows[0].r,'granted',plan);
    }
    await assert.rejects(()=>db.query("select public.grant_entitlement('00000000-0000-4000-8000-000000000020','matome',null,'test:m','evt:m')"),/invalid_entitlement/);
    await assert.rejects(()=>db.query("insert into public.entitlements(user_id,plan,source) values ('00000000-0000-4000-8000-000000000020','matome','test:m2')"));
    await db.exec("delete from public.entitlements; delete from public.stripe_events; delete from public.users;");
  }finally{await db.close();}
});

// ---- 購入ページ ----
test('kounyu-test.html: noindex, no arrows/emoji, no price literals, LIFF login, polling',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../kounyu-test.html'),'utf8');
  assert.match(html,/<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(html,/[→←↑↓]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.match(html,/試作（テスト決済・値段は仮置き）/);
  assert.match(html,/https:\/\/liff\.line\.me\/2011606963-hH0DzETc\/kounyu-test\.html/);
  assert.match(html,/\/api\/session/);assert.match(html,/\/api\/products/);assert.match(html,/tries>=10/);assert.match(html,/2000\)/);
  for(const p of products.PRODUCTS)assert.equal(html.includes(String(p.price)),false,'price literal '+p.price);
});
