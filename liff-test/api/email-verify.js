'use strict';
const s=require('../lib/server');
module.exports=s.endpoint(['POST'],async(req,res)=>{
  s.mutation(req);
  // Login proves email ownership through Supabase, even in a different browser.
  // The signed flow cookie carries only optional account-linking intent.
  const flow=s.verify(s.cookies(req).mimiobo_email_flow,'email');
  const {tokenHash,accessToken}=req.body;
  if(tokenHash!==undefined&&accessToken!==undefined)s.fail(400,'invalid_token');
  let verifiedToken=accessToken;
  if(accessToken!==undefined){
    if(typeof accessToken!=='string'||!accessToken||accessToken.length>10000||/\s/.test(accessToken))s.fail(400,'invalid_token');
  }else{
    if(typeof tokenHash!=='string'||!/^[a-zA-Z0-9_-]{16,512}$/.test(tokenHash))s.fail(400,'invalid_token');
    const verified=await s.supabase('/auth/v1/verify',{method:'POST',body:{token_hash:tokenHash,type:'email'}});
    if(typeof verified?.access_token!=='string')s.fail(401,'invalid_auth');
    verifiedToken=verified.access_token;
  }
  // REST equivalent of auth.getUser; browser claims / decoded JWTs are not trusted.
  const user=await s.supabase('/auth/v1/user',{accessToken:verifiedToken});
  if(!user?.email_confirmed_at||typeof user.email!=='string')s.fail(401,'email_mismatch');
  const address=s.email(user.email);
  const linkToken=flow?.linkToken;
  if(linkToken&&address!==flow.email)s.fail(401,'email_mismatch');
  const result=await s.login(req,res,'email',address,linkToken);
  s.setCookie(req,res,'mimiobo_email_flow','',0);
  return res.status(200).json(result);
});
