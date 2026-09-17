const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
function context(hash=''){
  const values=new Map(),requests=[],replacements=[];
  const location={hash,pathname:'/ep10-preview.html',search:'?server=1',replace:value=>replacements.push(value)};
  const ctx={window:{dispatchEvent(){}},location,history:{replaceState(a,b,url){replacements.push(url);location.hash='';}},sessionStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},URLSearchParams,Date,Event,AbortSignal,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({userId:'test'})};}};
  return {ctx,values,requests,replacements};
}
test('LINE link is captured after SDK initialization, sent once, and cleared on success',async()=>{
  const c=context('#link='+'a'.repeat(64));vm.runInNewContext(source('auth-client.js'),c.ctx);
  const auth=c.ctx.window.MimioboAuth;assert.equal(auth.hasPendingLink(),true);assert.equal(c.replacements.length,0);
  auth.captureLink();assert.equal(c.replacements[0],'/ep10-preview.html?server=1');assert.equal(c.values.size,1);
  await auth.line('test-line-token');assert.equal(JSON.parse(c.requests[0].options.body).linkToken,'a'.repeat(64));assert.equal(c.values.size,0);
  await auth.line('test-line-token');assert.equal(JSON.parse(c.requests[1].options.body).linkToken,undefined);
});
test('LINE linking invalid or expired state fails closed without creating an identity',async()=>{
  for(const value of ['not-json',JSON.stringify({token:'a'.repeat(64),expires:Date.now()-1}),JSON.stringify({token:'bad',expires:Date.now()+600000})]){
    const c=context();c.values.set('mimiobo-link-ticket',value);vm.runInNewContext(source('auth-client.js'),c.ctx);
    const auth=c.ctx.window.MimioboAuth;assert.equal(auth.hasPendingLink(),true);
    assert.throws(()=>auth.lineRedirectUri('https://example.test/ep10-preview.html?server=1'),/invalid_link/);
    await assert.rejects(auth.line('token'),/invalid_link/);assert.equal(c.requests.length,0);
  }
  for(const hash of ['#link=invalid','#link=','#link='+'a'.repeat(64)+'&link='+'b'.repeat(64)]){
    const c=context(hash);vm.runInNewContext(source('auth-client.js'),c.ctx);const auth=c.ctx.window.MimioboAuth;
    auth.captureLink();await assert.rejects(auth.line('token'),/invalid_link/);assert.equal(c.requests.length,0);
  }
});
test('LINE request failures retain linking intent until success or logout',async()=>{
  for(const failure of ['network','rejected']){
    const c=context('#link='+'a'.repeat(64));vm.runInNewContext(source('auth-client.js'),c.ctx);
    const auth=c.ctx.window.MimioboAuth;auth.captureLink();const fetch=c.ctx.fetch;
    c.ctx.fetch=async()=>{if(failure==='network')throw Error('offline');return {ok:false,status:409,json:async()=>({error:'identity_conflict'})};};
    await assert.rejects(auth.line('token'));assert.equal(auth.hasPendingLink(),true);
    c.ctx.fetch=fetch;await auth.logout();assert.equal(auth.hasPendingLink(),false);
  }
});
test('new LINE link is stored before navigation and uses only the opaque ticket in redirect',async()=>{
  const c=context(),ticket='b'.repeat(64);vm.runInNewContext(source('auth-client.js'),c.ctx);
  c.ctx.fetch=async()=>({ok:true,json:async()=>({linkToken:ticket,expiresIn:600})});
  const auth=c.ctx.window.MimioboAuth;assert.equal(await auth.linkLine(),'https://liff.line.me/2011606963-hH0DzETc/ep10-preview.html?server=1#link='+ticket);
  assert.equal(auth.hasPendingLink(),true);const redirect=new URL(auth.lineRedirectUri('https://example.test/ep10-preview.html?server=1'));
  assert.equal(redirect.searchParams.get('link'),ticket);assert.equal(redirect.searchParams.get('server'),'1');
  assert.ok(Number(redirect.searchParams.get('link_expires'))>Date.now());
});
test('email callback removes token fragment before verification and redirects without credentials',async()=>{
  const c=context('#token_hash=test-token-hash');c.ctx.location.pathname='/auth-callback.html';
  await vm.runInNewContext(source('auth-callback.js'),c.ctx);
  assert.deepEqual(c.replacements,['/auth-callback.html','/ep10-preview.html?server=1&auth=ok']);
  assert.equal(c.requests[0].url,'/api/email-verify');assert.equal(JSON.parse(c.requests[0].options.body).tokenHash,'test-token-hash');
});

test('default email callback sends only access token after clearing the entire fragment',async()=>{
  const c=context('#access_token=test-access-token&refresh_token=test-refresh-token&type=magiclink');
  c.ctx.location.pathname='/auth-callback.html';
  const request=c.ctx.fetch;
  c.ctx.fetch=async(url,options)=>{
    assert.equal(c.ctx.location.hash,'');
    assert.deepEqual(c.replacements,['/auth-callback.html']);
    assert.deepEqual(JSON.parse(options.body),{accessToken:'test-access-token'});
    assert.equal(options.credentials,'same-origin');
    return request(url,options);
  };
  c.ctx.localStorage={setItem(){assert.fail('must not store tokens');}};
  await vm.runInNewContext(source('auth-callback.js'),c.ctx);
  assert.equal(c.requests.length,1);assert.equal(c.requests[0].url,'/api/email-verify');
  assert.equal(c.values.size,0);
  assert.deepEqual(c.replacements,['/auth-callback.html','/ep10-preview.html?server=1&auth=ok']);
  assert.ok(!JSON.stringify(c.requests).includes('test-refresh-token'));
});

test('rejected access token and network failure leave no tokens in the callback URL',async()=>{
  for(const failure of ['rejected','network']){
    const c=context('#access_token=test-access-token&refresh_token=test-refresh-token');
    c.ctx.location.pathname='/auth-callback.html';
    c.ctx.fetch=async()=>{assert.equal(c.ctx.location.hash,'');if(failure==='network')throw Error('offline');return {ok:false,status:401};};
    await vm.runInNewContext(source('auth-callback.js'),c.ctx);
    assert.equal(c.values.size,0);assert.equal(c.ctx.location.hash,'');
    assert.equal(c.replacements.at(-1),'/ep10-preview.html?server=1&auth='+(failure==='network'?'unavailable':'failed'));
  }
});

test('refresh-only and ambiguous callback credentials are discarded without verification',async()=>{
  for(const fragment of ['#refresh_token=test-refresh-token','#access_token=test-access-token&token_hash=test-token-hash']){
    const c=context(fragment);c.ctx.location.pathname='/auth-callback.html';
    await vm.runInNewContext(source('auth-callback.js'),c.ctx);
    assert.equal(c.requests.length,0);assert.equal(c.values.size,0);assert.equal(c.ctx.location.hash,'');
    assert.equal(c.replacements.at(-1),'/ep10-preview.html?server=1&auth=invalid_token');
  }
});
