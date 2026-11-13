// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
const s=require('./_lib/server');
const products=require('./_lib/products');
// 学習カルテ用の回答記録。権利（ume/take/matsu/zenbu/bansou のどれか・期限内。text・haru だけでは通らない）の判定はここ（サーバー）で行う。集計はクライアント。
module.exports=s.endpoint(['GET'],async(req,res)=>{
  const current=await s.session(req);
  if(!(ents=>['ume','take','matsu','zenbu','bansou'].some(p=>products.has(ents,p)))(await s.entitlements(current.userId)))s.fail(403,'karte_not_entitled');
  const q=new URLSearchParams({select:'quiz_id,question_id,value,answered_at,attempt_id',user_id:'eq.'+current.userId,order:'answered_at.asc',limit:'5000'});
  const rows=await s.supabase('/rest/v1/answers?'+q);
  if(!Array.isArray(rows))s.fail(503,'database_unavailable');
  return res.status(200).json({rows:rows.map(r=>({quiz_id:r.quiz_id,question_id:r.question_id,value:r.value,answered_at:r.answered_at,attempt_id:r.attempt_id}))});
});
