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
  delete process.env.STRIPE_SECRET_KEY;delete process.env.ENTITLEMENT_VALID_UNTIL;delete process.env.ALLOW_TEXT_PREVIEW;delete process.env.STRIPE_ALLOW_LIVE;delete process.env.START_PRICE_OPEN_UNTIL;delete process.env.SHOW_ALL_PRODUCTS;delete process.env.CHECKOUT_RETURN_PATH;
  stripeLib.setClient(null);console.error=originalError;
  global.fetch=async()=>{throw Error('unmocked fetch');};
});
after(()=>{global.fetch=originalFetch;process.env=originalEnv;stripeLib.setClient(null);console.error=originalError;});
function response(){const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
const cookie=()=>s.COOKIE+'='+s.sign({purpose:'session',userId:user,provider:'email',subject:address,exp:Date.now()/1000+600});
function database(entitlements,createdAt='2020-01-01T00:00:00Z'){
  global.fetch=async url=>{const u=new URL(url);let data;
    if(u.pathname==='/rest/v1/allowlist')data=[{provider:'email'}];
    else if(u.pathname==='/rest/v1/identities')data=[{user_id:user}];
    else if(u.pathname==='/rest/v1/entitlements')data=entitlements;
    else if(u.pathname==='/rest/v1/answers')data=[];
    else if(u.pathname==='/rest/v1/users')data=[{created_at:createdAt}];
    else assert.fail('unexpected query '+u.pathname);
    return {ok:true,status:200,json:async()=>data};};
}
const ent=plan=>[{plan,valid_until:null}];

// ---- 台帳 ----
test('ledger: 8 products with plan, price and lookup_key takken2027_<code>',()=>{
  assert.deepEqual(products.PRODUCTS.map(p=>[p.code,p.price,p.plan,p.lookupKey]),[
    ['text',2980,'text','takken2027_text'],['haru8',2980,'haru','takken2027_haru8'],['natsu8',5980,'natsu','takken2027_natsu8'],
    ['last30',9800,'last30','takken2027_last30'],['last30_hayawari',8800,'last30','takken2027_last30_hayawari'],
    ['zenbu',19800,'zenbu','takken2027_zenbu'],['bansou',39800,'bansou','takken2027_bansou'],['bansou_1ki',10000,'bansou','takken2027_bansou_1ki']]);
  assert.equal(products.find('nope'),null);
});
test('ledger: only text is on sale and has a start price; the start lookup_key is separate',()=>{
  assert.deepEqual(products.PRODUCTS.filter(p=>p.sale).map(p=>p.code),['text']);
  assert.deepEqual(products.PRODUCTS.filter(p=>p.start).map(p=>[p.code,p.start.price,p.start.lookupKey]),[['text',2480,'takken2027_text_start']]);
  assert.deepEqual(products.saleProducts().map(p=>p.code),['text']);
  process.env.SHOW_ALL_PRODUCTS='1';assert.equal(products.saleProducts().length,8);assert.equal(products.onSale('bansou'),true);
  delete process.env.SHOW_ALL_PRODUCTS;assert.equal(products.onSale('bansou'),false);assert.equal(products.onSale('text'),true);assert.equal(products.onSale('nope'),false);
});
// ---- offer()：日付の境目は日本時間 ----
const J=s=>Date.parse(s);
test('offer: a product without a start price is always the normal price',()=>{
  for(const code of ['haru8','zenbu','bansou']){
    const p=products.find(code);
    assert.deepEqual(products.offer(p,{now:J('2027-01-05T00:00:00+09:00'),registeredAt:'2027-01-04T00:00:00+09:00'}),{kind:'tsujo',price:p.price,listPrice:p.price,startPrice:null,until:null,basis:null,lookupKey:p.lookupKey});
  }
});
test('offer: everyone gets the start price until 2027-01-11 23:59:59 JST, then only 7 days from registration',()=>{
  const text=products.find('text');
  const at=(now,registeredAt)=>products.offer(text,{now:J(now),registeredAt});
  let o=at('2027-01-11T23:59:59+09:00');
  assert.deepEqual(o,{kind:'start',price:2480,listPrice:2980,startPrice:2480,until:'2027-01-11',basis:'open',lookupKey:'takken2027_text_start'});
  assert.equal(at('2027-01-11T23:59:59.999+09:00').kind,'start');
  o=at('2027-01-12T00:00:00+09:00');
  assert.deepEqual(o,{kind:'tsujo',price:2980,listPrice:2980,startPrice:2480,until:null,basis:null,lookupKey:'takken2027_text'});
  assert.equal(at('2027-01-12T00:00:00+09:00','not a date').kind,'tsujo','登録の日が読めなければ通常');
  // 登録 2027-01-05（日本時間）が1日目：7日目は 1/11。だが開始のころの終わりも 1/11 なので境目は同じ。
  // 登録 2027-01-10 午前（日本時間）→ 7日目は 1/16。
  const reg='2027-01-10T09:00:00+09:00';
  o=at('2027-01-16T23:59:59+09:00',reg);
  assert.deepEqual([o.kind,o.basis,o.until,o.price],['start','touroku','2027-01-16',2480]);
  assert.deepEqual([at('2027-01-17T00:00:00+09:00',reg).kind,at('2027-01-17T00:00:00+09:00',reg).until],['tsujo',null]);
  // 登録の日の判定は日本時間：UTC で 1/9 23:30 は日本時間では 1/10 8:30＝1日目 → 7日目は 1/16
  assert.equal(at('2027-01-16T23:59:59+09:00','2027-01-09T23:30:00Z').kind,'start');
  assert.equal(at('2027-01-17T00:00:00+09:00','2027-01-09T23:30:00Z').kind,'tsujo');
  // 日本時間 0:00 ちょうどの登録は、その日が1日目
  assert.equal(at('2027-02-07T23:59:59+09:00','2027-02-01T00:00:00+09:00').kind,'start');
  assert.equal(at('2027-02-08T00:00:00+09:00','2027-02-01T00:00:00+09:00').kind,'tsujo');
  // 前日の 23:59:59 の登録は前日が1日目（7日目は 2/6）
  assert.equal(at('2027-02-07T00:00:00+09:00','2027-01-31T23:59:59+09:00').kind,'tsujo');
  assert.equal(at('2027-02-06T23:59:59+09:00','2027-01-31T23:59:59+09:00').kind,'start');
  // 開始のころの間は until は全員 1/11。そのあとも登録から7日目までは touroku でスタート価格が続く
  o=at('2027-01-08T12:00:00+09:00','2027-01-08T10:00:00+09:00');
  assert.deepEqual([o.kind,o.basis,o.until],['start','open','2027-01-11']);
  o=at('2027-01-12T00:00:00+09:00','2027-01-08T10:00:00+09:00');assert.deepEqual([o.kind,o.basis,o.until],['start','touroku','2027-01-14']);
  assert.equal(at('2027-01-14T23:59:59+09:00','2027-01-08T10:00:00+09:00').kind,'start');
  assert.equal(at('2027-01-15T00:00:00+09:00','2027-01-08T10:00:00+09:00').kind,'tsujo');
});
test('offer: START_PRICE_OPEN_UNTIL overrides the end of the opening period; an invalid value falls back to the default',()=>{
  const text=products.find('text');
  process.env.START_PRICE_OPEN_UNTIL='2027-02-01T23:59:59+09:00';
  assert.equal(products.offer(text,{now:J('2027-02-01T23:59:59+09:00')}).kind,'start');
  assert.equal(products.offer(text,{now:J('2027-02-02T00:00:00+09:00')}).kind,'tsujo');
  assert.equal(products.offer(text,{now:J('2027-02-01T23:59:59+09:00')}).until,'2027-02-01');
  for(const bad of ['nope','','  ']){
    process.env.START_PRICE_OPEN_UNTIL=bad;
    assert.equal(products.offer(text,{now:J('2027-01-11T23:59:59+09:00')}).kind,'start',bad);
    assert.equal(products.offer(text,{now:J('2027-01-12T00:00:00+09:00')}).kind,'tsujo',bad);
  }
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
const productsReq=(withCookie=false,cookieValue)=>({method:'GET',url:'/api/products',headers:{host:'localhost:3000',...(withCookie?{cookie:cookieValue||cookie()}:{})}});
test('GET /api/products logged out: sale products only, loggedIn false, owned [], offers without lookup_key, validUntil in JST date',async()=>{
  global.fetch=async()=>assert.fail('no database call expected without a session cookie');
  process.env.START_PRICE_OPEN_UNTIL='2999-01-01T23:59:59+09:00';
  const res=response();await productsApi(productsReq(),res);
  assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'no-store');
  assert.deepEqual(res.data.products,[{code:'text',name:'やさしいテキスト',price:2980,plan:'text'}]);
  assert.deepEqual(Object.keys(res.data).sort(),['includes','loggedIn','offers','owned','products','validUntil']);
  assert.equal(res.data.loggedIn,false);assert.deepEqual(res.data.owned,[]);
  assert.deepEqual(res.data.offers,{text:{kind:'start',price:2480,listPrice:2980,startPrice:2480,until:'2999-01-01',basis:'open'}});
  assert.equal(res.data.validUntil,'2027-10-17');
  assert.deepEqual(res.data.includes.zenbu.sort(),['haru','last30','matome','natsu','text','zenbu']);
  assert.doesNotMatch(JSON.stringify(res.data),/lookup|takken2027_/);
  process.env.ENTITLEMENT_VALID_UNTIL='2028-10-15T23:59:59+09:00';
  const again=response();await productsApi(productsReq(),again);assert.equal(again.data.validUntil,'2028-10-15');
  // 全部見せる
  process.env.SHOW_ALL_PRODUCTS='1';
  const all=response();await productsApi(productsReq(),all);assert.equal(all.data.products.length,8);
});
test('GET /api/products: a missing, broken, expired or forged cookie is just logged out (never 401)',async()=>{
  for(const c of [undefined,'mimiobo_session=garbage',s.COOKIE+'='+s.sign({purpose:'session',userId:user,provider:'email',subject:address,exp:Date.now()/1000-10}),s.COOKIE+'='+s.sign({purpose:'other',userId:user,provider:'email',subject:address,exp:Date.now()/1000+600})]){
    global.fetch=async()=>({ok:true,status:200,json:async()=>[]});
    const res=response();await productsApi(productsReq(!!c,c),res);
    assert.equal(res.code,200,String(c));assert.equal(res.data.loggedIn,false);assert.deepEqual(res.data.owned,[]);
  }
  // 許可リストに無い（403 not_allowed）も、ログインしていない扱い
  global.fetch=async url=>({ok:true,status:200,json:async()=>new URL(url).pathname==='/rest/v1/allowlist'?[]:[{user_id:user}]});
  const res=response();await productsApi(productsReq(true),res);assert.equal(res.code,200);assert.equal(res.data.loggedIn,false);
});
test('GET /api/products logged in: owned is expanded, the offer follows the registration day; purchased people see their rights',async()=>{
  process.env.START_PRICE_OPEN_UNTIL='2020-01-01T00:00:00+09:00';
  database([],new Date(Date.now()-2*86400000).toISOString());
  let res=response();await productsApi(productsReq(true),res);
  assert.equal(res.code,200);assert.equal(res.data.loggedIn,true);assert.deepEqual(res.data.owned,[]);
  assert.deepEqual([res.data.offers.text.kind,res.data.offers.text.basis,res.data.offers.text.price],['start','touroku',2480]);
  assert.match(res.data.offers.text.until,/^\d{4}-\d\d-\d\d$/);
  database([],'2020-01-01T00:00:00Z');
  res=response();await productsApi(productsReq(true),res);
  assert.deepEqual(res.data.offers.text,{kind:'tsujo',price:2980,listPrice:2980,startPrice:2480,until:null,basis:null});
  database([{plan:'zenbu',valid_until:null},{plan:'ume',valid_until:'2000-01-01T00:00:00+00:00'}]);
  res=response();await productsApi(productsReq(true),res);
  assert.deepEqual(res.data.owned.sort(),['haru','last30','matome','natsu','text','zenbu']);
  // データベースの不調は 503 のまま（ログアウト扱いにしない）
  global.fetch=async url=>new URL(url).pathname==='/rest/v1/entitlements'?{ok:false,status:500,json:async()=>({})}:{ok:true,status:200,json:async()=>new URL(url).pathname==='/rest/v1/allowlist'?[{provider:'email'}]:new URL(url).pathname==='/rest/v1/identities'?[{user_id:user}]:[{created_at:'2020-01-01T00:00:00Z'}]};
  res=response();await productsApi(productsReq(true),res);assert.equal(res.code,503);
});
test('GET /api/products?keepalive=1 still returns only ok',async()=>{
  global.fetch=async()=>({ok:true,status:200,json:async()=>[{id:user}]});
  const res=response();await productsApi({method:'GET',url:'/api/products?keepalive=1',headers:{host:'localhost:3000'}},res);
  assert.deepEqual(res.data,{ok:true});
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
  process.env.SHOW_ALL_PRODUCTS='1';process.env.START_PRICE_OPEN_UNTIL='2020-01-01T00:00:00+09:00'; // 開始のころは過ぎた・登録も古い＝通常の値段
  const prices=Object.fromEntries(products.PRODUCTS.map(p=>[p.lookupKey,'price_'+p.code]));
  const fake=fakeStripe({prices});stripeLib.setClient(fake);database([]);
  for(const p of products.PRODUCTS){
    const res=response();await checkoutApi(checkoutRequest({product:p.code}),res);
    assert.equal(res.code,200,p.code);assert.deepEqual(res.data,{url:'https://checkout.stripe.com/c/pay/cs_test_abc'});
    const call=fake.calls.at(-1);
    assert.deepEqual(fake.lookups.at(-1),{lookup_keys:[p.lookupKey],active:true,limit:1});
    assert.deepEqual(call,{mode:'payment',client_reference_id:user,metadata:{userId:user,plan:p.plan,product:p.code,price_kind:'tsujo'},
      line_items:[{price:'price_'+p.code,quantity:1}],
      success_url:'http://localhost:3000/kounyu.html?checkout=ok&product='+p.code,cancel_url:'http://localhost:3000/kounyu.html?checkout=cancel'});
  }
});
test('checkout: the start price is used for everyone in the opening period and for 7 days after registration; otherwise the normal price',async()=>{
  const prices={takken2027_text:'price_normal',takken2027_text_start:'price_start'};
  const run=async(open,createdAt)=>{
    process.env.START_PRICE_OPEN_UNTIL=open;
    const fake=fakeStripe({prices});stripeLib.setClient(fake);database([],createdAt);
    const res=response();await checkoutApi(checkoutRequest({product:'text'}),res);assert.equal(res.code,200);
    return {metadata:fake.calls[0].metadata,price:fake.calls[0].line_items[0].price,lookups:fake.lookups.map(l=>l.lookup_keys[0])};
  };
  const old='2020-01-01T00:00:00Z',recent=new Date(Date.now()-86400000).toISOString(),past='2020-01-01T00:00:00+09:00',future='2999-01-01T00:00:00+09:00';
  let r=await run(future,old);assert.deepEqual([r.price,r.metadata.price_kind,r.lookups],['price_start','start',['takken2027_text_start']]);
  r=await run(past,recent);assert.deepEqual([r.price,r.metadata.price_kind],['price_start','start']);
  r=await run(past,old);assert.deepEqual([r.price,r.metadata.price_kind,r.lookups],['price_normal','tsujo',['takken2027_text']]);
  assert.deepEqual(r.metadata,{userId:user,plan:'text',product:'text',price_kind:'tsujo'});
});
test('checkout: a start price that is not set up in Stripe is payment_not_configured (it never falls back to the normal price)',async()=>{
  process.env.START_PRICE_OPEN_UNTIL='2999-01-01T00:00:00+09:00';
  const fake=fakeStripe({prices:{takken2027_text:'price_normal'}});stripeLib.setClient(fake);database([]);
  const res=response();await checkoutApi(checkoutRequest({product:'text'}),res);
  assert.equal(res.code,503);assert.equal(res.data.error,'payment_not_configured');assert.equal(fake.calls.length,0);
});
test('checkout: a person who already has the plan gets 409 already_purchased (also through zenbu / bansou); others and expired rights can buy',async()=>{
  process.env.START_PRICE_OPEN_UNTIL='2999-01-01T00:00:00+09:00';
  const prices={takken2027_text_start:'price_start',takken2027_text:'price_normal'};
  for(const plan of ['text','zenbu','bansou']){
    const fake=fakeStripe({prices});stripeLib.setClient(fake);database(ent(plan));
    const res=response();await checkoutApi(checkoutRequest({product:'text'}),res);
    assert.equal(res.code,409,plan);assert.deepEqual(res.data,{error:'already_purchased'});assert.equal(fake.calls.length,0);
  }
  for(const rows of [[],ent('haru'),ent('ume')]){
    const fake=fakeStripe({prices});stripeLib.setClient(fake);database(rows);
    const res=response();await checkoutApi(checkoutRequest({product:'text'}),res);assert.equal(res.code,200,JSON.stringify(rows));
  }
  // 期限切れの権利は持っていない扱い（entitlements() は期限内だけ返す）
  const fake=fakeStripe({prices});stripeLib.setClient(fake);database([{plan:'text',valid_until:'2000-01-01T00:00:00+00:00'}]);
  const res=response();await checkoutApi(checkoutRequest({product:'text'}),res);assert.equal(res.code,200);
});
test('checkout: a product that is not on sale is 400 invalid_product unless SHOW_ALL_PRODUCTS=1; CHECKOUT_RETURN_PATH still overrides the return page',async()=>{
  const prices={...Object.fromEntries(products.PRODUCTS.map(p=>[p.lookupKey,'price_'+p.code])),takken2027_text_start:'price_text_start'};
  const fake=fakeStripe({prices});stripeLib.setClient(fake);database([]);
  for(const code of ['haru8','natsu8','last30','last30_hayawari','zenbu','bansou','bansou_1ki']){
    const res=response();await checkoutApi(checkoutRequest({product:code}),res);assert.equal(res.code,400,code);assert.deepEqual(res.data,{error:'invalid_product'});
  }
  assert.equal(fake.calls.length,0);assert.equal(fake.lookups.length,0);
  process.env.SHOW_ALL_PRODUCTS='1';
  let res=response();await checkoutApi(checkoutRequest({product:'haru8'}),res);assert.equal(res.code,200);
  delete process.env.SHOW_ALL_PRODUCTS;process.env.CHECKOUT_RETURN_PATH='/shop/kounyu.html';
  res=response();await checkoutApi(checkoutRequest({product:'text'}),res);assert.equal(res.code,200);
  assert.equal(fake.calls.at(-1).success_url,'http://localhost:3000/shop/kounyu.html?checkout=ok&product=text');
  assert.equal(fake.calls.at(-1).cancel_url,'http://localhost:3000/shop/kounyu.html?checkout=cancel');
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
const event=(sessionOver={},over={})=>({id:'evt_test_1',object:'event',type:'checkout.session.completed',created:1790000000,livemode:false,data:{object:{id:'cs_test_abc',object:'checkout.session',payment_status:'paid',client_reference_id:user,metadata:{userId:user,plan:'ume'},amount_total:2980,currency:'jpy',payment_intent:'pi_test_1',...sessionOver}},...over});
const sign=payload=>realStripe.webhooks.generateTestHeaderString({payload,secret:whsec});
function webhook(payload){return {method:'POST',headers:{'stripe-signature':sign(payload),'content-type':'application/json'},rawBody:Buffer.from(payload),body:{parsed:true}};}
function grantMock(calls){stripeLib.setClient(realStripe);global.fetch=async(url,options)=>{assert.equal(new URL(url).pathname,'/rest/v1/rpc/record_purchase');calls.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>'granted'};};}
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
