'use strict';
const fs=require('node:fs'),path=require('node:path');
const s=require('../lib/server');
const products=require('../lib/products');
// やさしいテキストの印刷用A4版（PDF・有料）。判定は ep-text.js と同じ（ログイン＋plan text。mihon=1 は ALLOW_TEXT_PREVIEW=1 のときだけログインなし）。
// 実体は api/_ep-text/ep1.pdf（URLでは取れない場所。scripts/build-ep1-text.mjs がコピーする）。
const NAME='やさしいテキスト_第1回_宅建業と免許.pdf';
const FILES={1:'ep1.pdf'};
// テストで読み込みを差し替えられるようにする
const source={read:ep=>fs.readFileSync(path.join(__dirname,'_ep-text',FILES[ep]))};
const handler=s.endpoint(['GET'],async(req,res)=>{
  const url=new URL(req.url||'/','http://localhost'),ep=url.searchParams.get('ep');
  if(!/^[1-9]\d{0,2}$/.test(ep||'')||!FILES[Number(ep)])s.fail(404,'not_found');
  const preview=url.searchParams.get('mihon')==='1'&&process.env.ALLOW_TEXT_PREVIEW==='1';
  if(!preview){
    const current=await s.session(req);
    if(!products.has(await s.entitlements(current.userId),'text'))s.fail(403,'text_not_entitled');
  }
  const pdf=source.read(Number(ep));
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',"inline; filename*=UTF-8''"+encodeURIComponent(NAME));
  res.setHeader('Cache-Control','no-store');
  return res.status(200).send(pdf);
});
handler.source=source;
module.exports=handler;
