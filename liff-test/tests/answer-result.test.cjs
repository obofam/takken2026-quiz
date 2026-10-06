const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../ep10-preview.html'),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const paintAnswerSource=script.match(/function paintAnswer\(i\)\{[\s\S]*?\n\}/)[0];

// 3つのボタンと解説ブロックだけを持つ最小の偽DOM。
function el(){return {className:'',textContent:'',hidden:true,disabled:false,attrs:{},setAttribute(k,v){this.attrs[k]=v;}};}
function harness(q,answer){
  const buttons=[el(),el(),el()],box=el(),verdict=el(),mark=el(),vtext=el(),explanation=el(),law=el();
  box.className='explanation';verdict.className='verdict';
  const parts={'.explanation':box,'.verdict':verdict,'.mark':mark,'.vtext':vtext,'.answer-explanation':explanation,'.law':law};
  const card={querySelectorAll:()=>buttons,querySelector:sel=>parts[sel]};
  const ctx=vm.createContext({answers:[answer],questions:[q],$:()=>card});
  vm.runInContext(paintAnswerSource+';paintAnswer(0);',ctx);
  return {buttons,box,verdict,mark,vtext,explanation,law};
}
const q={id:'q1',answer:true,explanation:'解説の本文',law:'根拠：宅建業法1条'};

test('verdict pill: correct answer starts with a ○ mark and gets the lime classes',()=>{
  const h=harness(q,{value:true});
  assert.equal(h.mark.textContent+' '+h.vtext.textContent,'○ 正解です');
  assert.equal(h.verdict.className,'verdict correct');assert.equal(h.box.className,'explanation correct');assert.equal(h.box.hidden,false);
});
test('verdict pill: wrong answer starts with × and has no lime class',()=>{
  const t=harness(q,{value:false});
  assert.equal(t.mark.textContent+' '+t.vtext.textContent,'× 正解は○です');
  assert.equal(t.verdict.className,'verdict');assert.equal(t.box.className,'explanation');
  const f=harness({...q,answer:false},{value:true});
  assert.equal(f.mark.textContent+' '+f.vtext.textContent,'× 正解は×です');
});
test('verdict pill: "まだ分からない" shows only the correct answer, no mark, no lime',()=>{
  const h=harness(q,{value:null});
  assert.equal(h.mark.textContent,'');assert.equal(h.vtext.textContent,'正解は○です');
  assert.equal(h.verdict.className,'verdict');assert.equal(h.box.className,'explanation');
});
test('chosen button stays aria-pressed=true; explanation and law text are passed through unchanged',()=>{
  const h=harness(q,{value:false});
  assert.deepEqual(h.buttons.map(b=>b.attrs['aria-pressed']),['false','true','false']);
  assert.ok(h.buttons.every(b=>b.disabled));
  assert.equal(h.explanation.textContent,'解説の本文');assert.equal(h.law.textContent,'根拠：宅建業法1条');
  assert.deepEqual(harness(q,{value:null}).buttons.map(b=>b.attrs['aria-pressed']),['false','false','true']);
});
test('markup: verdict comes first, then the 解説 subheading, text and law; old class names are kept',()=>{
  const m=html.match(/<div class="explanation"[^>]*>[\s\S]*?<\/div>`/)[0];
  const order=['class="verdict"','class="ex-label">解説<','class="answer-explanation"','class="small muted law"'].map(s=>m.indexOf(s));
  assert.ok(order.every(n=>n>=0),String(order));assert.deepEqual(order,[...order].sort((a,b)=>a-b));
});
test('CSS: chosen button keeps dark text over the disabled grey; others fade; lime only on correct',()=>{
  const css=html.match(/<style>\s*\/\* ep10-only answer-result[\s\S]*?<\/style>/)[0];
  for(const rule of ['.answer:disabled{color:inherit}','.answer[aria-pressed=true]{color:#141B21;background:#e4f6fb;border:2px solid #10758a;opacity:1}','button:not([aria-pressed=true]){opacity:.45}',
    '.explanation.correct{border-left-color:#D6F034}','.explanation .verdict.correct{background:#F4FBD2;color:#4F6300}','border-left:4px solid #17C5E8','letter-spacing:.1em','border-top:1px dotted'])assert.ok(css.includes(rule),rule);
  assert.ok(css.includes('@media(max-width:480px){.explanation{padding:14px}.explanation .answer-explanation{font-size:15px}}'));
});
test('the <style> and <script> blocks of ep10-preview.html are balanced and parse',()=>{
  assert.equal((html.match(/<style>/g)||[]).length,(html.match(/<\/style>/g)||[]).length);
  assert.doesNotThrow(()=>new Function(script));
});
