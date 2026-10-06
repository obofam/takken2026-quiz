// 問題セット（content/gyoho_ep1-11.json など）を台帳 quiz-catalog.js に取り込む。
//   検査だけ：  node scripts/import-content.mjs content/gyoho_ep1-11.json
//   反映する：  node scripts/import-content.mjs content/gyoho_ep1-11.json --write
// 形が正しくないものは1件も書き込まない（全部通ったときだけ反映）。第10回（ep10）は手で管理しているので上書きしない。
// 入力の形：[{quizId,episode,title,subject,audioUrl,questions:[{id,topic,text,answer,explanation,law}],sourceRows?,check?}]
// quiz-catalog.js の DATA_BEGIN〜DATA_END の間だけを書き換える。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const SUBJECTS=['宅建業法','権利関係','法令上の制限','税・その他'];
const PROTECTED=['ep10'];
const here=path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_FILE=path.join(here,'..','quiz-catalog.js');
const text=v=>typeof v==='string'&&v.trim().length>0;

// 入力の形を検査する。返り値 {entries, problems, warnings, skipped}。problems が空でなければ反映しない。
export function validateEntries(list){
  const problems=[],warnings=[],skipped=[],entries={};
  if(!Array.isArray(list)||!list.length){return {entries,problems:['入力は1件以上の配列にしてください。'],warnings,skipped};}
  const seenQuestions=new Set();
  list.forEach((item,index)=>{
    const where=(item&&item.quizId)||('#'+(index+1)),bad=message=>problems.push(where+'：'+message);
    if(!item||typeof item!=='object'||Array.isArray(item))return bad('オブジェクトではありません。');
    if(!Number.isInteger(item.episode)||item.episode<1||item.episode>999)return bad('episode は 1〜999 の整数にしてください。');
    const quizId='ep'+item.episode;
    if(item.quizId!==quizId)return bad('quizId は ep'+item.episode+' にしてください。');
    if(PROTECTED.includes(quizId)){skipped.push(quizId);return;}
    if(entries[quizId])return bad('同じ quizId が2回あります。');
    if(!text(item.title))bad('title がありません。');
    if(!SUBJECTS.includes(item.subject))bad('subject は '+SUBJECTS.join('／')+' のどれかにしてください。');
    if(typeof item.audioUrl!=='string'||!/^https:\/\//.test(item.audioUrl))bad('audioUrl は https:// で始まる URL にしてください。');
    if(!Array.isArray(item.questions)||item.questions.length!==3)return bad('questions はちょうど3問にしてください。');
    const ids=new Set();
    item.questions.forEach((q,n)=>{
      const label=where+' Q'+(n+1)+'：';
      if(!q||typeof q!=='object')return problems.push(label+'問題がオブジェクトではありません。');
      if(typeof q.id!=='string'||!new RegExp('^'+quizId+'-[a-z0-9]{1,16}$').test(q.id))problems.push(label+'id は '+quizId+'-<英小文字・数字1〜16字> にしてください。');
      else if(ids.has(q.id)||seenQuestions.has(q.id))problems.push(label+'id '+q.id+' が重複しています。');
      else{ids.add(q.id);seenQuestions.add(q.id);}
      for(const key of ['topic','text','explanation','law'])if(!text(q[key]))problems.push(label+key+' がありません。');
      if(text(q.law)&&!q.law.startsWith('根拠：'))problems.push(label+'law は「根拠：…」の形にしてください。');
      if(text(q.topic)&&[...q.topic].length>20)warnings.push(label+'topic が長めです（'+[...q.topic].length+'字）。10〜14字程度が目安です。');
      if(typeof q.answer!=='boolean')problems.push(label+'answer は true／false にしてください。');
    });
    const answers=item.questions.map(q=>q&&q.answer);
    if(!answers.includes(true)||!answers.includes(false))bad('○と×が少なくとも1問ずつ必要です。');
    for(const c of Array.isArray(item.check)?item.check:[])if(c&&typeof c.status==='string'&&!c.status.startsWith('条文照合OK'))warnings.push(where+' '+c.id+'：'+c.status+(c.note?'（'+c.note+'）':''));
    entries[quizId]={
      episode:item.episode,title:item.title,subject:item.subject,audioUrl:item.audioUrl,page:'ep10-preview.html?ep='+item.episode,
      questions:(item.questions||[]).map(q=>({id:q&&q.id,topic:q&&q.topic,text:q&&q.text,answer:q&&q.answer,explanation:q&&q.explanation,law:q&&q.law}))
    };
  });
  return {entries,problems,warnings,skipped};
}

const BEGIN='/*DATA_BEGIN*/',END='/*DATA_END*/';
const json=v=>JSON.stringify(v);
// 台帳の1件を、読みやすい形（問題は1行ずつ）で書き出す。
export function serialize(catalog){
  const quizzes=Object.entries(catalog).sort((a,b)=>a[1].episode-b[1].episode).map(([quizId,quiz])=>{
    const lines=Object.entries(quiz).map(([key,value])=>key==='questions'
      ?'      "questions":[\n'+value.map(q=>'        '+json(q)).join(',\n')+'\n      ]'
      :'      '+json(key)+':'+json(value));
    return '    '+json(quizId)+':{\n'+lines.join(',\n')+'\n    }';
  });
  return '{\n'+quizzes.join(',\n')+'\n  }';
}

// 台帳のソース文字列に entries を足す（同じ quizId は置き換え、それ以外はそのまま）。
export function mergeSource(source,entries){
  const start=source.indexOf(BEGIN),end=source.indexOf(END);
  if(start<0||end<start)throw Error('quiz-catalog.js に '+BEGIN+' と '+END+' が見つかりません。');
  const current=vm.runInNewContext('('+source.slice(start+BEGIN.length,end)+')');
  const merged={...current};
  for(const [quizId,entry] of Object.entries(entries)){
    // audioMinutes など、入力に無い任意の項目は既存の回から引き継ぐ。
    const old=current[quizId]||{};
    merged[quizId]={...entry,...(old.audioMinutes?{audioMinutes:old.audioMinutes}:{})};
  }
  const next=source.slice(0,start+BEGIN.length)+serialize(merged)+source.slice(end);
  // 書いた結果を読み直して、意図どおりか確かめる。
  const check=vm.runInNewContext('('+next.slice(next.indexOf(BEGIN)+BEGIN.length,next.indexOf(END))+')');
  if(JSON.stringify(check)!==JSON.stringify(Object.fromEntries(Object.entries(merged).sort((a,b)=>a[1].episode-b[1].episode))))throw Error('書き出した台帳が意図と一致しません。');
  return {source:next,catalog:merged};
}

export function run(argv,{catalogFile=CATALOG_FILE,log=console.log}={}){
  const write=argv.includes('--write'),file=argv.find(a=>!a.startsWith('--'));
  if(!file){log('使い方：node scripts/import-content.mjs <JSONファイル> [--write]');return 2;}
  let list;
  try{list=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){log('読めません：'+e.message);return 1;}
  const {entries,problems,warnings,skipped}=validateEntries(list);
  for(const w of warnings)log('注意：'+w);
  if(skipped.length)log('第10回は取り込みません（手で管理）：'+skipped.join(', '));
  if(problems.length){for(const p of problems)log('エラー：'+p);log('1件も書き込んでいません。');return 1;}
  const names=Object.keys(entries);
  if(!names.length){log('取り込む回がありません。');return 1;}
  const merged=mergeSource(fs.readFileSync(catalogFile,'utf8'),entries);
  if(!write){log('検査OK：'+names.join(', ')+'（'+names.length+'回）。反映するには --write を付けます。');return 0;}
  fs.writeFileSync(catalogFile,merged.source,'utf8');
  log('quiz-catalog.js に反映しました：'+names.join(', ')+'。続けて npm test を実行してください。');
  return 0;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exit(run(process.argv.slice(2)));
