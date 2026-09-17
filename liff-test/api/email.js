'use strict';
const s=require('../lib/server');
module.exports=s.endpoint(['POST'],async(req,res)=>{
  s.mutation(req);const address=s.email(req.body.email);
  if(!await s.allowed('email',address))s.fail(403,'not_allowed');
  let linkToken;
  if(req.body.link===true)linkToken=await s.ticket((await s.session(req)).userId,'email',address);
  else if(req.body.link!==undefined&&req.body.link!==false)s.fail(400,'invalid_link');
  const redirect=s.origin(req)+'/auth-callback.html';
  await s.supabase('/auth/v1/otp?redirect_to='+encodeURIComponent(redirect),{method:'POST',body:{email:address,create_user:true}});
  s.setCookie(req,res,'mimiobo_email_flow',s.sign({purpose:'email',email:address,linkToken,exp:Math.floor(Date.now()/1000)+600}),600);
  return res.status(200).json({ok:true});
});
