'use strict';
const s=require('../lib/server');
module.exports=s.endpoint(['POST'],async(req,res)=>{
  s.mutation(req);
  const flow=s.verify(s.cookies(req).mimiobo_email_flow,'email');if(!flow)s.fail(401,'email_request_required');
  const token=req.body.tokenHash;
  if(typeof token!=='string'||!/^[a-zA-Z0-9_-]{16,512}$/.test(token))s.fail(400,'invalid_token');
  const verified=await s.supabase('/auth/v1/verify',{method:'POST',body:{token_hash:token,type:'email'}});
  if(typeof verified?.access_token!=='string')s.fail(401,'invalid_auth');
  // REST equivalent of auth.getUser; browser claims / decoded JWTs are not trusted.
  const user=await s.supabase('/auth/v1/user',{accessToken:verified.access_token});
  if(!user?.email_confirmed_at||s.email(user.email)!==flow.email)s.fail(401,'email_mismatch');
  const result=await s.login(req,res,'email',flow.email,flow.linkToken);
  s.setCookie(req,res,'mimiobo_email_flow','',0);
  return res.status(200).json(result);
});
