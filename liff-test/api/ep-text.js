'use strict';
const s=require('../lib/server');
// やさしいテキスト（有料）。ログインと権利（plan text・期限内）の判定はここ（サーバー）で行い、中身は権利があるときだけ返す。
// 中身は api/_ep-text/ 以下（URLでは取れない場所）。mihon=1 は環境変数 ALLOW_TEXT_PREVIEW が '1' のときだけ、ログインなしで返す（見本の確認用）。
const TEXTS={1:()=>require('./_ep-text/ep1')};
module.exports=s.endpoint(['GET'],async(req,res)=>{
  const url=new URL(req.url||'/','http://localhost'),ep=url.searchParams.get('ep');
  if(!/^[1-9]\d{0,2}$/.test(ep||'')||!TEXTS[Number(ep)])s.fail(404,'not_found');
  const preview=url.searchParams.get('mihon')==='1'&&process.env.ALLOW_TEXT_PREVIEW==='1';
  if(!preview){
    const current=await s.session(req);
    if(!(await s.entitlements(current.userId)).some(e=>e.plan==='text'))s.fail(403,'text_not_entitled');
  }
  return res.status(200).json({html:TEXTS[Number(ep)]()});
});
