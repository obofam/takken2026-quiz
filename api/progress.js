// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
const s=require('./_lib/server');
// 聴いた・復習（listened）と3問済（done）の記録。ログインした人だけ。表の形と検査は supabase/migrations/202611130001_progress.sql。
const isMap=v=>v&&typeof v==='object'&&!Array.isArray(v);
const shape=row=>({listened:isMap(row?.listened)?row.listened:{},done:isMap(row?.done)?row.done:{},updatedAt:row?.updated_at??null});
module.exports=s.endpoint(['GET','POST'],async(req,res)=>{
  if(req.method==='POST')s.mutation(req);
  const current=await s.session(req);
  if(req.method==='GET'){
    const q=new URLSearchParams({select:'listened,done,updated_at',user_id:'eq.'+current.userId,limit:'1'});
    const rows=await s.supabase('/rest/v1/progress?'+q);
    if(!Array.isArray(rows))s.fail(503,'database_unavailable');
    return res.status(200).json(shape(rows[0]));
  }
  const b=req.body;let result;
  if(b.merge===true){
    if(!isMap(b.listened)||!isMap(b.done))s.fail(400,'invalid_progress');
    result=await s.supabase('/rest/v1/rpc/merge_progress',{method:'POST',body:{p_user_id:current.userId,p_listened:b.listened,p_done:b.done}});
  }else{
    if(typeof b.kind!=='string'||typeof b.key!=='string'||!('value' in b))s.fail(400,'invalid_progress');
    result=await s.supabase('/rest/v1/rpc/set_progress',{method:'POST',body:{p_user_id:current.userId,p_kind:b.kind,p_key:b.key,p_value:b.value===undefined?null:b.value}});
  }
  if(!isMap(result))s.fail(503,'database_unavailable');
  const out=shape(result);
  return res.status(200).json({listened:out.listened,done:out.done,updatedAt:out.updatedAt});
});
