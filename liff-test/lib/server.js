'use strict';
const {createHash,createHmac,timingSafeEqual,randomBytes}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE='mimiobo_session';
class HttpError extends Error { constructor(status,code){super(code);this.status=status;} }
const fail=(status,code)=>{throw new HttpError(status,code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
function secret(){const s=process.env.SESSION_SECRET;if(!s||Buffer.byteLength(s)<32)fail(503,'session_not_configured');return s;}
function sign(payload){const body=Buffer.from(JSON.stringify(payload)).toString('base64url');return body+'.'+createHmac('sha256',secret()).update(body).digest('base64url');}
function verify(token,purpose,now=Date.now()/1000){
  if(typeof token!=='string'||token.length>4096)return null;
  const [body,mac,...extra]=token.split('.');if(!body||!mac||extra.length)return null;
  const expected=createHmac('sha256',secret()).update(body).digest(),actual=Buffer.from(mac,'base64url');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
  try{const data=JSON.parse(Buffer.from(body,'base64url'));return data.purpose===purpose&&Number.isFinite(data.exp)&&data.exp>now?data:null;}catch{return null;}
}
function cookies(req){return Object.fromEntries((req.headers?.cookie||'').split(';').map(v=>v.trim().split(/=(.*)/s).slice(0,2)).filter(v=>v.length===2));}
function origin(req){
  const host=req.headers?.host;
  if(typeof host!=='string'||!/^([a-z0-9.-]+)(:\d+)?$/i.test(host))fail(400,'invalid_host');
  const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if(!local&&host!=='mimiobo-liff-test.vercel.app'&&host!==process.env.VERCEL_URL&&host!==process.env.VERCEL_BRANCH_URL)fail(403,'host_not_allowed');
  return (local?'http://':'https://')+host;
}
function mutation(req){
  const expected=origin(req),headers=req.headers||{},sentOrigin=headers.origin,site=headers['sec-fetch-site'];
  if(site!==undefined&&!['same-origin','none'].includes(site))fail(403,'origin_not_allowed');
  let sameReferer=false;
  if(headers.referer!==undefined){
    try{sameReferer=typeof headers.referer==='string'&&new URL(headers.referer).origin===expected;}catch{}
    if(!sameReferer)fail(403,'origin_not_allowed');
  }
  // Only an absent Origin may use WebView fallbacks; explicit null/mismatches fail closed.
  if(sentOrigin!==undefined?sentOrigin!==expected:site!=='same-origin'&&!sameReferer)fail(403,'origin_not_allowed');
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))fail(415,'json_required');
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||JSON.stringify(req.body).length>16000)fail(400,'invalid_body');
}
function setCookie(req,res,name,value,seconds){
  const line=`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${origin(req).startsWith('https:')?'; Secure':''}`;
  const previous=res.getHeader?.('Set-Cookie');res.setHeader('Set-Cookie',[...(Array.isArray(previous)?previous:previous?[previous]:[]),line]);
}
async function supabase(path,{method='GET',body,accessToken}={}){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)||!key?.startsWith('sb_secret_'))fail(503,'database_not_configured');
  const response=await fetch(url.replace(/\/$/,'')+path,{method,headers:{apikey:key,...(accessToken?{Authorization:'Bearer '+accessToken}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const message=data?.message||'';
    if(message.includes('identity_conflict'))fail(409,'identity_conflict');
    if(message.includes('attempt_owner_mismatch'))fail(409,'attempt_conflict');
    if(message.includes('invalid_answer'))fail(400,'invalid_answer');
    if(['22007','22008'].includes(data?.code))fail(400,'invalid_answer_time');
    if(message.includes('not_allowed'))fail(403,'not_allowed');
    if(message.includes('invalid_link'))fail(401,'invalid_link');
    if(path.startsWith('/auth/')&&response.status===429)fail(429,'try_later');
    if(path.startsWith('/auth/')&&response.status<500)fail(401,'invalid_auth');
    fail(503,'database_unavailable');
  }
  return data;
}
async function allowed(provider,subject){const q=new URLSearchParams({select:'provider',provider:'eq.'+provider,subject:'eq.'+subject,limit:'1'});return (await supabase('/rest/v1/allowlist?'+q)).length===1;}
async function session(req){
  const s=verify(cookies(req)[COOKIE],'session');if(!s||!UUID.test(s.userId)||!['email','line'].includes(s.provider)||typeof s.subject!=='string')fail(401,'login_required');
  if(!await allowed(s.provider,s.subject))fail(403,'not_allowed');
  const q=new URLSearchParams({select:'user_id',user_id:'eq.'+s.userId,provider:'eq.'+s.provider,subject:'eq.'+s.subject,limit:'1'});
  if((await supabase('/rest/v1/identities?'+q)).length!==1)fail(401,'login_required');
  if(req.headers?.['x-mimiobo-user']&&req.headers['x-mimiobo-user']!==s.userId)fail(401,'user_changed');
  return s;
}
function sessionData(userId){return {userId,storageKey:'mimiobo-test-v1-'+hash(userId)};}
async function login(req,res,provider,subject,linkToken){
  if(linkToken!==undefined&&(typeof linkToken!=='string'||!/^[0-9a-f]{64}$/.test(linkToken)))fail(400,'invalid_link');
  const userId=await supabase('/rest/v1/rpc/resolve_identity',{method:'POST',body:{p_provider:provider,p_subject:subject,p_link_token_hash:linkToken?hash(linkToken):null}});
  if(!UUID.test(userId))fail(503,'invalid_identity');
  setCookie(req,res,COOKIE,sign({purpose:'session',userId,provider,subject,exp:Math.floor(Date.now()/1000)+604800}),604800);
  return sessionData(userId);
}
async function ticket(userId,provider,subject=null){const token=randomBytes(32).toString('hex');await supabase('/rest/v1/link_tickets',{method:'POST',body:{token_hash:hash(token),user_id:userId,provider,subject,expires_at:new Date(Date.now()+600000).toISOString()}});return token;}
function email(value){if(typeof value!=='string')fail(400,'invalid_email');const normalized=value.trim().toLowerCase();if(normalized.length>254||! /^[^\s@,()<>]+@[^\s@,()<>]+\.[^\s@,()<>]+$/.test(normalized))fail(400,'invalid_email');return normalized;}
function endpoint(methods,run){return async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');try{if(!methods.includes(req.method)){res.setHeader('Allow',methods.join(', '));fail(405,'method_not_allowed');}return await run(req,res);}catch(e){
  if(!(e instanceof HttpError)){
    // Never log the exception itself: messages, stacks and request data may contain secrets.
    const name=['Error','TypeError','RangeError','SyntaxError','AbortError','TimeoutError'].includes(e?.name)?e.name:'UnknownError';
    console.error('endpoint_unexpected_error',{name});
  }
  return res.status(e instanceof HttpError?e.status:503).json({error:e instanceof HttpError?e.message:'service_unavailable'});
}};}
module.exports={UUID,COOKIE,HttpError,fail,hash,sign,verify,cookies,origin,mutation,setCookie,supabase,allowed,session,sessionData,login,ticket,email,endpoint};
