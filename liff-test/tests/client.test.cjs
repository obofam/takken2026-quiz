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
test('email callback removes token fragment before verification and redirects without credentials',async()=>{
  const c=context('#token_hash=test-token-hash');c.ctx.location.pathname='/auth-callback.html';
  await vm.runInNewContext(source('auth-callback.js'),c.ctx);
  assert.deepEqual(c.replacements,['/auth-callback.html','/ep10-preview.html?server=1&auth=ok']);
  assert.equal(c.requests[0].url,'/api/email-verify');assert.equal(JSON.parse(c.requests[0].options.body).tokenHash,'test-token-hash');
});
