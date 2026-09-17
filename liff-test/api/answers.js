'use strict';
const s=require('../lib/server');
const QUESTIONS=['ep10-money','ep10-join','ep10-add'];
function validate(body){
  if(!body||typeof body.attemptId!=='string'||!s.UUID.test(body.attemptId)||body.quizId!=='ep10'||!QUESTIONS.includes(body.questionId)||![true,false,null].includes(body.value))s.fail(400,'invalid_answer');
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  if(!validDate(body.startedAt)||!validDate(body.answeredAt)||Date.parse(body.startedAt)>Date.parse(body.answeredAt)||Date.parse(body.answeredAt)>Date.now()+300000)s.fail(400,'invalid_answer_time');
  return {p_attempt_id:body.attemptId,p_quiz_id:body.quizId,p_started_at:body.startedAt,p_question_id:body.questionId,p_value:body.value,p_answered_at:body.answeredAt};
}
module.exports=s.endpoint(['GET','POST'],async(req,res)=>{
  if(req.method==='POST')s.mutation(req);
  const current=await s.session(req);
  if(req.method==='POST'){
    if(req.headers?.['x-mimiobo-user']!==current.userId)s.fail(401,'user_changed');
    await s.supabase('/rest/v1/rpc/save_answer',{method:'POST',body:{...validate(req.body),p_user_id:current.userId}});
    return res.status(200).json({ok:true});
  }
  const quiz=req.query?.quiz??new URL(req.url,'http://localhost').searchParams.get('quiz');
  if(quiz!=='ep10')s.fail(400,'invalid_quiz');
  const rows=[];
  for(let offset=0;offset<=1000;offset+=500){
    const q=new URLSearchParams({select:'id,started_at,answers(question_id,value,answered_at)',user_id:'eq.'+current.userId,quiz_id:'eq.ep10',order:'started_at.asc,id.asc',limit:'500',offset:String(offset)});
    const batch=await s.supabase('/rest/v1/attempts?'+q);rows.push(...batch);if(batch.length<500)break;
  }
  if(rows.length>1000)s.fail(409,'history_limit');
  return res.status(200).json({version:'ep10-2026-09-15.v1',attempts:rows.map(a=>({id:a.id,startedAt:a.started_at,answers:QUESTIONS.map(id=>{const row=a.answers.find(r=>r.question_id===id);return row?{value:row.value,at:row.answered_at}:null;})}))});
});
module.exports.validate=validate;
