// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
const s=require('./_lib/server');
// 聴いた・復習（listened）・3問済（done）・過去問1選の結果（kako）・○×1日1問の記録（ox）の記録。ログインした人だけ。表の形と検査は supabase/migrations/202611130001_progress.sql・202611130004_progress_kako.sql・202611170001_progress_ox.sql。
const isMap=v=>v&&typeof v==='object'&&!Array.isArray(v);
const shape=row=>({listened:isMap(row?.listened)?row.listened:{},done:isMap(row?.done)?row.done:{},kako:isMap(row?.kako)?row.kako:{},ox:isMap(row?.ox)?row.ox:{},updatedAt:row?.updated_at??null});
// kako／ox の列がまだ無い表（migration 202611130004／202611170001 の適用前）でも、今ある種類は今までどおり動かす。
async function readRow(userId){
  const read=cols=>s.supabase('/rest/v1/progress?'+new URLSearchParams({select:cols,user_id:'eq.'+userId,limit:'1'}));
  let rows;
  try{rows=await read('listened,done,kako,ox,updated_at');}
  catch(e){try{rows=await read('listened,done,kako,updated_at');}catch(e2){rows=await read('listened,done,updated_at');}}
  return rows;
}
module.exports=s.endpoint(['GET','POST'],async(req,res)=>{
  if(req.method==='POST')s.mutation(req);
  const current=await s.session(req);
  if(req.method==='GET'){
    const rows=await readRow(current.userId);
    if(!Array.isArray(rows))s.fail(503,'database_unavailable');
    return res.status(200).json(shape(rows[0]));
  }
  const b=req.body;let result;
  if(b.merge===true){
    const kako=b.kako===undefined?{}:b.kako;
    const ox=b.ox===undefined?{}:b.ox;
    if(!isMap(b.listened)||!isMap(b.done)||!isMap(kako)||!isMap(ox))s.fail(400,'invalid_progress');
    // kako／ox が空のときは p_kako／p_ox を付けない（migration の適用前でも、古い画面と同じ呼び方で通る）
    const body={p_user_id:current.userId,p_listened:b.listened,p_done:b.done,...(Object.keys(kako).length?{p_kako:kako}:{}),...(Object.keys(ox).length?{p_ox:ox}:{})};
    result=await s.supabase('/rest/v1/rpc/merge_progress',{method:'POST',body});
  }else{
    if(typeof b.kind!=='string'||typeof b.key!=='string'||!('value' in b))s.fail(400,'invalid_progress');
    result=await s.supabase('/rest/v1/rpc/set_progress',{method:'POST',body:{p_user_id:current.userId,p_kind:b.kind,p_key:b.key,p_value:b.value===undefined?null:b.value}});
  }
  if(!isMap(result))s.fail(503,'database_unavailable');
  const out=shape(result);
  return res.status(200).json({listened:out.listened,done:out.done,kako:out.kako,ox:out.ox,updatedAt:out.updatedAt});
});
