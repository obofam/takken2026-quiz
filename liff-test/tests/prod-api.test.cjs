// 本番側（リポジトリ直下の api/）の入口と、環境変数での切り替え（ALLOWED_HOSTS / OPEN_LOGIN / STORAGE_PREFIX）。
const {test,after,beforeEach}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const prod=path.resolve(__dirname,'..','..');
const session=require(path.join(prod,'api/session'));
const s=require(path.join(prod,'api/_lib/server'));
const original=global.fetch,env={...process.env};
const SEC='SESSION_'+'SECRET',KEY='SUPABASE_'+'SECRET_KEY';
after(()=>{global.fetch=original;process.env=env;});
beforeEach(()=>{
  process.env={...env,LINE_CHANNEL_ID:'2012583516',[SEC]:'test-value-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',[KEY]:'sb_'+'secret_test_only'};
  for(const k of ['ALLOWED_HOSTS','OPEN_LOGIN','STORAGE_PREFIX','CHECKOUT_RETURN_PATH'])delete process.env[k];
});
const response=()=>{const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};};
const user='12345678-1234-4123-8123-123456789abc';

test('本番側の api/ 直下の関数は12個以下（Vercel無料プラン）。_始まりは数えない',()=>{
  const fns=fs.readdirSync(path.join(prod,'api'),{withFileTypes:true}).filter(e=>e.isFile()&&/\.(js|mjs|cjs|ts)$/.test(e.name)&&!e.name.startsWith('_'));
  assert.ok(fns.length<=12,'関数が多すぎる: '+fns.length);
});
test('本番側のコードは liff-test の正本と同じ（sync-prod.mjs --check）',()=>{
  const r=spawnSync(process.execPath,[path.join(__dirname,'..','scripts','sync-prod.mjs'),'--check'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
});
test('本番の画面側：progress-sync.js は正本の写しで、ロードマップ・第1回・ログインの画面がつながっている。戻り先と行き先',()=>{
  const read=f=>fs.readFileSync(path.join(prod,f),'utf8');
  assert.equal(read('progress-sync.js').split(String.fromCharCode(10)).slice(1).join(String.fromCharCode(10)),fs.readFileSync(path.join(__dirname,'..','progress-sync.js'),'utf8'));
  const road=read('roadmap/index.html'),ep=read('ep/1/index.html'),login=read('login/index.html');
  assert.match(road,/TakkenProgress\.init\(\{ liffId: '2012583516-7vmvMorb', cookieHint: true/);
  assert.match(road,/pgSet\('listened'/);assert.match(road,/href="\/login"/);
  assert.equal((road.match(/href="\/login"/g)||[]).length,2); // 初期表示と、描き直しの注記だけ
  assert.match(ep,/TakkenProgress\.set\('done'/);assert.match(ep,/init\(\{cookieHint: true, onChange: updateKiroku\}\)/);assert.ok(!/TakkenProgress\.init\(\{liffId/.test(ep)); // 二重に liff.init しない
  assert.match(login,/<meta name="robots" content="noindex">/);assert.match(login,/cloud\.umami\.is/);assert.match(login,/liff\.line\.me\/2012583516-7vmvMorb\/roadmap/);
  assert.ok(!/ep10-preview|checks\.html|karte|宅建ドック/.test(login));
  const cb=read('auth-callback.js');
  assert.match(cb,/'\/roadmap'/);assert.match(cb,/\/login\?auth=/);assert.ok(!/mimiobo-next|ep10-preview|account\.html|roadmap-an2/.test(cb));
  // /login は login/index.html、/auth-callback.html はファイルそのまま：リライトは要らない
  assert.ok(fs.existsSync(path.join(prod,'auth-callback.html')));
});
test('直下の vercel.json：公開ページのヘッダーなどは足さず、cron とPDF同梱だけ。.vercelignore は api を除外しない',()=>{
  const v=JSON.parse(fs.readFileSync(path.join(prod,'vercel.json'),'utf8'));
  assert.equal(v.headers,undefined);assert.equal(v.rewrites,undefined);
  assert.equal(v.crons[0].path,'/api/products?keepalive=1');
  assert.equal(v.functions['api/ep-pdf.js'].includeFiles,'api/_ep-text/**');assert.equal(v.functions['api/ep-text.js'].includeFiles,'api/_ep-text/**');
  assert.ok(!/noindex/.test(JSON.stringify(v)));
  const ign=fs.readFileSync(path.join(prod,'.vercelignore'),'utf8').split(/\r?\n/);
  assert.ok(!ign.some(l=>/^\/?api\b/.test(l)||/_ep-text/.test(l)),'.vercelignore が api を除外している');
  assert.ok(/^api\/_ep-text\/$/m.test(fs.readFileSync(path.join(prod,'.gitignore'),'utf8')));
});
test('ALLOWED_HOSTS：未設定なら本番の住所は通らず、設定すれば通る（試し用の住所は常に通る）',()=>{
  const req=host=>({headers:{host}});
  assert.throws(()=>s.origin(req('takken.mimiobo.com')),e=>e.status===403);
  assert.equal(s.origin(req('mimiobo-liff-test.vercel.app')),'https://mimiobo-liff-test.vercel.app');
  process.env.ALLOWED_HOSTS='takken.mimiobo.com, other.example';
  assert.equal(s.origin(req('takken.mimiobo.com')),'https://takken.mimiobo.com');
  assert.equal(s.origin(req('other.example')),'https://other.example');
  assert.throws(()=>s.origin(req('attacker.example')),e=>e.status===403);
  assert.throws(()=>s.origin(req('takken.mimiobo.com.attacker.example')),e=>e.status===403);
});
test('OPEN_LOGIN：未設定なら許可リストを見る。1なら見ない（DBへ聞かない）',async()=>{
  const seen=[];global.fetch=async url=>{seen.push(new URL(url).pathname);return {ok:true,status:200,json:async()=>[]};};
  assert.equal(await s.allowed('line','x'),false);assert.deepEqual(seen,['/rest/v1/allowlist']);
  process.env.OPEN_LOGIN='1';seen.length=0;
  assert.equal(await s.allowed('line','x'),true);assert.equal(await s.allowed('email','a@b.co'),true);assert.deepEqual(seen,[]);
  process.env.OPEN_LOGIN='0';assert.equal(await s.allowed('line','x'),false);
});
async function lineLogin(host){
  const sent=[];
  global.fetch=async(url,options)=>{
    if(url==='https://api.line.me/oauth2/v2.1/verify'){assert.equal(options.body.get('client_id'),'2012583516');return {ok:true,json:async()=>({aud:'2012583516',iss:'https://access.line.me',exp:Date.now()/1000+100,sub:'someone'})};}
    const u=new URL(url);sent.push([u.pathname,options.body?JSON.parse(options.body):null]);
    return {ok:true,status:200,json:async()=>u.pathname==='/rest/v1/rpc/resolve_identity'?user:[]};
  };
  const res=response();
  await session({method:'POST',headers:{host,origin:'https://'+host,'content-type':'application/json'},body:{idToken:'dummy'}},res);
  return {res,sent};
}
test('本番側の session：ALLOWED_HOSTS・STORAGE_PREFIX・OPEN_LOGIN を設定すると変わり、未設定なら今までどおり',async()=>{
  let r=await lineLogin('takken.mimiobo.com');assert.equal(r.res.code,403);
  r=await lineLogin('mimiobo-liff-test.vercel.app');
  assert.equal(r.res.code,200);assert.equal(r.res.data.storageKey,'mimiobo-test-v1-'+s.hash(user));
  assert.equal('p_open' in r.sent.find(x=>x[0]==='/rest/v1/rpc/resolve_identity')[1],false);
  Object.assign(process.env,{ALLOWED_HOSTS:'takken.mimiobo.com',STORAGE_PREFIX:'mimiobo-v1-',OPEN_LOGIN:'1'});
  r=await lineLogin('takken.mimiobo.com');
  assert.equal(r.res.code,200);assert.equal(r.res.data.storageKey,'mimiobo-v1-'+s.hash(user));
  assert.equal(r.sent.find(x=>x[0]==='/rest/v1/rpc/resolve_identity')[1].p_open,true);
  assert.match(r.res.headers['Set-Cookie'][0],/Secure$/);
});
test('checkout の戻り先：未設定は kounyu.html（売り場）、CHECKOUT_RETURN_PATH で変えられ、不正な値は無視',async()=>{
  const checkout=require(path.join(prod,'api/checkout')),stripe=require(path.join(prod,'api/_lib/stripe'));
  let created;stripe.setClient({prices:{list:async()=>({data:[{id:'price_x1'}]})},checkout:{sessions:{create:async a=>{created=a;return {url:'https://checkout.stripe.com/x'};}}}});
  try{
    process.env.ALLOWED_HOSTS='takken.mimiobo.com';
    const cookie=s.COOKIE+'='+s.sign({purpose:'session',userId:user,provider:'line',subject:'abc',exp:Math.floor(Date.now()/1000)+600});
    process.env.OPEN_LOGIN='1';
    global.fetch=async url=>{const p=new URL(url).pathname;return {ok:true,status:200,json:async()=>p==='/rest/v1/identities'?[{user_id:user}]:[]};};
    const run=async()=>{const res=response();await checkout({method:'POST',headers:{host:'takken.mimiobo.com',origin:'https://takken.mimiobo.com','content-type':'application/json','x-mimiobo-user':user,cookie},body:{product:'text'}},res);return res;};
    let res=await run();assert.equal(res.code,200);assert.match(created.success_url,/^https:\/\/takken\.mimiobo\.com\/kounyu\.html\?checkout=ok&product=text$/);
    process.env.CHECKOUT_RETURN_PATH='/kau.html';await run();assert.match(created.success_url,/\/kau\.html\?checkout=ok/);assert.match(created.cancel_url,/\/kau\.html\?checkout=cancel/);
    process.env.CHECKOUT_RETURN_PATH='//evil.example';await run();assert.match(created.success_url,/^https:\/\/takken\.mimiobo\.com\/kounyu\.html/);
  }finally{stripe.setClient(null);}
});
