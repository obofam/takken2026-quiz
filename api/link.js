// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
const s=require('./_lib/server');
module.exports=s.endpoint(['POST'],async(req,res)=>{
  s.mutation(req);const current=await s.session(req);
  if(req.body.provider!=='line')s.fail(400,'invalid_provider');
  return res.status(200).json({linkToken:await s.ticket(current.userId,'line'),expiresIn:600});
});
