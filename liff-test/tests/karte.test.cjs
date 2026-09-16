const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../ep10-preview.html'),'utf8');
const source=html.split('// KARTE_SUMMARY_BEGIN')[1].split('// KARTE_SUMMARY_END')[0];
const summarize=vm.runInNewContext(source+';summarizeKarte');
const questions=[{id:'one',topic:'論点',answer:true}];
const attempt=(value,at)=>({answers:[{value,at}]});
test('unanswered retry does not erase prior evidence',()=>{const s=summarize([attempt(false,'2026-09-01T00:00:00Z'),{answers:[null]}],questions)[0];assert.equal(s.correct,false);assert.equal(s.latest.value,false);});
test('same-day retry and seven-day retry remain distinguishable',()=>{for(const [at,days] of [['2026-09-01T01:00:00Z',0],['2026-09-08T00:00:00Z',7]]){const s=summarize([attempt(null,'2026-09-01T00:00:00Z'),attempt(true,at)],questions)[0];assert.equal(s.improved,true);assert.equal(s.days,days);}});
test('latest wrong answer supersedes previous success even when input order differs',()=>{const s=summarize([attempt(false,'2026-09-02T00:00:00Z'),attempt(true,'2026-09-01T00:00:00Z')],questions)[0];assert.equal(s.correct,false);assert.equal(s.improved,false);});
