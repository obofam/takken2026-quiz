'use strict';
const $=id=>document.getElementById(id);
let storageKey='',records=[],currentPlan=null,ready=false;
const destinations={audio:'https://stand.fm/channels/69b1fa4b75c28fe6990cf326',quiz:'https://takken2026-quiz.vercel.app/#sample',karte:'https://takken2026-quiz.vercel.app/karte.html'};
function renderHistory(){
  $('historySummary').textContent=records.length?`取り組んだ記録：${records.length}回`:'まだ記録はありません。今日できたことから残しましょう。';
  $('history').replaceChildren();
  for(const item of [...records].reverse().slice(0,10)){const li=document.createElement('li');li.textContent=`${new Date(item.at).toLocaleDateString('ja-JP')}　${item.title}`;$('history').append(li);}
}
async function enter(){
  $('message').textContent='本人確認をしています…';
  const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:liff.getIDToken()})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'本人確認に失敗しました。');
  storageKey=result.storageKey;
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');records=Array.isArray(saved)?saved.filter(r=>r&&typeof r.title==='string'&&typeof r.at==='string'&&!isNaN(Date.parse(r.at))).slice(-100):[];}catch{records=[];}
  $('welcome').hidden=true;$('workspace').hidden=false;renderHistory();
}
$('connect').onclick=async()=>{if(!ready)return;$('connect').disabled=true;try{if(!liff.isLoggedIn()){liff.login({redirectUri:location.origin+'/'});return;}await enter();}catch(e){$('message').textContent=e.message;$('connect').disabled=false;}};
$('planForm').onsubmit=e=>{e.preventDefault();const stage=$('stage').value,time=$('time').value,pace=$('pace').value;
  if(time==='listen'||pace!=='steady'||stage==='start')currentPlan={title:pace==='return'?'知っている回を、少しだけ聴く':'今日は、耳からひとつ',text:stage==='start'?'番組一覧から、今のテキストで学ぶ範囲の回を選んでください。途中まででも大丈夫です。':'前に聴いた回から選んでみましょう。最後まで聴くことや、問題を解くことは必須ではありません。',url:destinations.audio,label:'番組を開く'};
  else if(stage==='finish'&&time==='15')currentPlan={title:'解いた過去問を、振り返る',text:'令和5〜7年度の解答済み過去問があれば、間違えた番号から復習候補を確認できます。まだ解いていなければ、今日は番組を聴くだけでも大丈夫です。',url:destinations.karte,label:'模試ふりかえりカルテを開く'};
  else currentPlan={title:'お試し5問で、確かめる',text:'既存の分野横断のお試し問題を開きます。まだ学んでいない問題があれば、無理に解かなくて大丈夫です。今回は学習範囲に合わせた出し分けはまだ行いません。',url:destinations.quiz,label:'お試し5問を開く'};
  $('nextTitle').textContent=currentPlan.title;$('nextText').textContent=currentPlan.text;$('nextLink').href=currentPlan.url;$('nextLink').textContent=currentPlan.label;$('suggestion').hidden=false;$('done').disabled=false;$('saveStatus').textContent='';$('suggestion').scrollIntoView({behavior:'smooth',block:'start'});
};
$('done').onclick=()=>{if(!currentPlan||!storageKey||$('done').disabled)return;const next=[...records,{at:new Date().toISOString(),title:currentPlan.title,stage:$('stage').value,time:$('time').value,pace:$('pace').value}].slice(-100);try{localStorage.setItem(storageKey,JSON.stringify(next));records=next;$('saveStatus').textContent='このブラウザーに記録しました。今日はここまででも大丈夫です。';$('done').disabled=true;renderHistory();}catch{$('saveStatus').textContent='保存できませんでした。ブラウザーの保存設定をご確認ください。';}};
$('reset').onclick=()=>{if(!storageKey||!confirm('このブラウザーのテスト記録を消しますか？ LINEとの連携は解除されません。'))return;try{localStorage.removeItem(storageKey);records=[];renderHistory();$('saveStatus').textContent='テスト記録を消しました。';}catch{$('saveStatus').textContent='削除できませんでした。';}};
(async()=>{try{if(!window.TEST_LIFF_ID){$('connect').textContent='LINE接続の設定準備中';$('message').textContent='設定が終わると、このボタンから試せます。';return;}if(!window.liff)throw Error('LINEの読み込みに失敗しました。ページを開き直してください。');await liff.init({liffId:window.TEST_LIFF_ID});ready=true;$('connect').disabled=false;$('connect').textContent='LINEで連携して試す';if(liff.isLoggedIn())await enter();}catch(e){$('message').textContent=e.message;$('connect').disabled=!ready;}})();
