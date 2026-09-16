const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const html=fs.readFileSync(require('node:path').join(__dirname,'../ep10-preview.html'),'utf8');
const source=html.split('// PROGRESS_STORE_BEGIN')[1].split('// PROGRESS_STORE_END')[0];
const store=vm.runInNewContext(source+';ProgressStore',{crypto:webcrypto});
function memory(){const values=new Map();return{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};}
test('restore partial answers, preserving unknown versus unanswered',()=>{
  const storage=memory(),a=store.open(storage,'one');a.record(1,null);a.save();
  const restored=store.open(storage,'one');assert.equal(restored.current.answers[0],null);assert.equal(restored.current.answers[1].value,null);assert.equal(restored.current.answers[2],null);
  restored.record(0,true);restored.save();assert.equal(store.open(storage,'one').current.answers[0].value,true);
});
test('retry keeps the previous attempt and does not replace its answers',()=>{
  const storage=memory(),a=store.open(storage,'one');a.record(0,false);a.save();const first=a.current.id;
  a.begin();a.record(0,true);a.save();const restored=store.open(storage,'one');assert.equal(restored.data.attempts.length,2);assert.equal(restored.data.attempts[0].id,first);assert.equal(restored.data.attempts[0].answers[0].value,false);assert.equal(restored.current.answers[0].value,true);
});
test('double submission does not alter an already answered question',()=>{
  const a=store.open(memory(),'one');assert.equal(a.record(0,true),true);assert.equal(a.record(0,false),false);assert.equal(a.current.answers[0].value,true);
});
test('storage failure is surfaced and durable data remains intact',()=>{
  const storage=memory(),a=store.open(storage,'one');a.record(0,true);a.save();const saved=storage.getItem('one');
  const write=storage.setItem;storage.setItem=()=>{throw Error('QuotaExceededError');};a.record(1,false);assert.throws(()=>a.save(),/QuotaExceeded/);assert.equal(storage.getItem('one'),saved);
  storage.setItem=write;a.save();assert.equal(store.open(storage,'one').current.answers[1].value,false);
});
test('stale tab cannot overwrite an observed newer version',()=>{
  const storage=memory(),a=store.open(storage,'one'),b=store.open(storage,'one');a.record(0,true);a.save();b.record(1,false);assert.throws(()=>b.save(),/別の画面/);assert.equal(store.open(storage,'one').current.answers[1],null);
});
test('corrupt or incompatible data is not overwritten',()=>{
  for(const raw of ['{broken',JSON.stringify({version:'future',attempts:[]}),JSON.stringify({version:'ep10-2026-09-15.v1',attempts:[{id:'x',startedAt:'bad',answers:[]}]})]){
    const storage=memory();storage.setItem('one',raw);assert.throws(()=>store.open(storage,'one'));assert.equal(storage.getItem('one'),raw);
  }
});
test('local preview and authenticated users have separate storage',()=>{
  const storage=memory(),a=store.open(storage,'local'),b=store.open(storage,'line-owner');a.record(0,true);a.save();assert.equal(b.current,undefined);assert.equal(store.open(storage,'line-owner').current,undefined);
});
