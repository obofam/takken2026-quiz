'use strict';
const s=require('../lib/server');
module.exports=s.endpoint(['GET','POST','DELETE'],async(req,res)=>{
  if(req.method==='GET')return res.status(200).json(await s.linkedSessionData((await s.session(req)).userId));
  s.mutation(req);
  if(req.method==='DELETE'){s.setCookie(req,res,s.COOKIE,'',0);s.setCookie(req,res,'mimiobo_email_flow','',0);return res.status(200).json({ok:true});}
  const token=req.body.idToken;
  if(typeof token!=='string'||!token||token.length>10000)s.fail(400,'invalid_token');
  const channel=process.env.LINE_CHANNEL_ID;if(!/^\d+$/.test(channel||''))s.fail(503,'line_not_configured');
  const reply=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id_token:token,client_id:channel}),signal:AbortSignal.timeout(10000)});
  if(!reply.ok)s.fail(401,'invalid_line_token');
  const claims=await reply.json();
  if(claims.aud!==channel||claims.iss!=='https://access.line.me'||typeof claims.sub!=='string'||!claims.sub||!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000)s.fail(401,'invalid_line_claims');
  return res.status(200).json(await s.login(req,res,'line',s.hash(claims.sub),req.body.linkToken));
});
