'use strict';
const fs=require('node:fs'),path=require('node:path');
const s=require('../lib/server');
const products=require('../lib/products');
// やさしいテキストの印刷用A4版（PDF・有料）。判定は ep-text.js と同じ（ログイン＋plan text。mihon=1 は ALLOW_TEXT_PREVIEW=1 のときだけログインなし）。
// 実体は api/_ep-text/ep<N>.pdf（URLでは取れない場所。scripts/build-ep.mjs がコピーする）。ダウンロード名は ep<N>.meta.json の name（無ければ「やさしいテキスト_第N回.pdf」）。
const DIR=path.join(__dirname,'_ep-text');
// 配信日（ep<N>.meta.json の open。第1回は無い＝閉じない）の前は、権利があっても 404（日本時間のその日の 0:00 から開く）。mihon=1 は日付に関係なく返す。
const closedYet=ep=>{try{const o=JSON.parse(fs.readFileSync(path.join(DIR,'ep'+ep+'.meta.json'),'utf8')).open;return !!o&&new Date(Date.now()+9*3600*1000).toISOString().slice(0,10)<o;}catch(e){return false;}};
// テストで読み込みを差し替えられるようにする
const source={
  exists:ep=>fs.existsSync(path.join(DIR,'ep'+ep+'.pdf')),
  read:ep=>fs.readFileSync(path.join(DIR,'ep'+ep+'.pdf')),
  name:ep=>{try{return JSON.parse(fs.readFileSync(path.join(DIR,'ep'+ep+'.meta.json'),'utf8')).name;}catch(e){return null;}},
};
const handler=s.endpoint(['GET'],async(req,res)=>{
  const url=new URL(req.url||'/','http://localhost'),ep=url.searchParams.get('ep');
  if(!/^[1-9]\d{0,2}$/.test(ep||'')||!source.exists(Number(ep)))s.fail(404,'not_found');
  const preview=url.searchParams.get('mihon')==='1'&&process.env.ALLOW_TEXT_PREVIEW==='1';
  if(!preview&&closedYet(Number(ep)))s.fail(404,'not_found');
  if(!preview){
    const current=await s.session(req);
    if(!products.has(await s.entitlements(current.userId),'text'))s.fail(403,'text_not_entitled');
  }
  const pdf=source.read(Number(ep));
  const name=source.name(Number(ep))||'やさしいテキスト_第'+Number(ep)+'回.pdf';
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',"inline; filename*=UTF-8''"+encodeURIComponent(name));
  res.setHeader('Cache-Control','no-store');
  return res.status(200).send(pdf);
});
handler.source=source;
module.exports=handler;
