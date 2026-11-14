// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
const fs=require('node:fs'),path=require('node:path');
const s=require('./_lib/server');
const products=require('./_lib/products');
// やさしいテキスト（有料）。ログインと権利（plan text・期限内）の判定はここ（サーバー）で行い、中身は権利があるときだけ返す。
// 中身は api/_ep-text/ep<N>.js（URLでは取れない場所。scripts/build-ep.mjs が書く）。置いてある回ならどれでも返す（回の番号は 1〜999 の数字だけ）。
// 本番に置くのは ep-release.json の prod に入っている回だけ。vercel.json の includeFiles で api/_ep-text/ を関数に載せる。
// mihon=1 は環境変数 ALLOW_TEXT_PREVIEW が '1' のときだけ、ログインなしで返す（見本の確認用）。
const DIR=path.join(__dirname,'_ep-text');
const exists=ep=>fs.existsSync(path.join(DIR,'ep'+ep+'.js'));
// 配信日（ep<N>.meta.json の open。第1回は無い＝閉じない）の前は、権利があっても 404（日本時間のその日の 0:00 から開く）。mihon=1 は日付に関係なく返す。
const closedYet=ep=>{try{const o=JSON.parse(fs.readFileSync(path.join(DIR,'ep'+ep+'.meta.json'),'utf8')).open;return !!o&&new Date(Date.now()+9*3600*1000).toISOString().slice(0,10)<o;}catch(e){return false;}};
module.exports=s.endpoint(['GET'],async(req,res)=>{
  const url=new URL(req.url||'/','http://localhost'),ep=url.searchParams.get('ep');
  if(!/^[1-9]\d{0,2}$/.test(ep||'')||!exists(Number(ep)))s.fail(404,'not_found');
  const preview=url.searchParams.get('mihon')==='1'&&process.env.ALLOW_TEXT_PREVIEW==='1';
  if(!preview&&closedYet(Number(ep)))s.fail(404,'not_found');
  if(!preview){
    const current=await s.session(req);
    if(!products.has(await s.entitlements(current.userId),'text'))s.fail(403,'text_not_entitled');
  }
  return res.status(200).json({html:require('./_ep-text/ep'+Number(ep))});
});
