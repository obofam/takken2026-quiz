const {createHash}=require('node:crypto');
const CHANNEL='2011606963';
const OWNER_HASH='397e24b712bf64ed73b8c9bc4a66eccbeabe281f49c32670cb0fbb894de98902';
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'POST required'});}
  const token=req.body?.idToken;
  if(typeof token!=='string'||!token||token.length>10000)return res.status(400).json({error:'ログイン情報がありません。'});
  try{
    const reply=await fetch('https://api.line.me/oauth2/v2.1/verify',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({id_token:token,client_id:CHANNEL}),signal:AbortSignal.timeout(10000)
    });
    if(!reply.ok)return res.status(401).json({error:'LINEでログインし直してください。'});
    const claims=await reply.json();
    if(claims.aud!==CHANNEL||claims.iss!=='https://access.line.me'||typeof claims.sub!=='string'||!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000)
      return res.status(401).json({error:'ログイン情報を確認できませんでした。'});
    const key=createHash('sha256').update(claims.sub).digest('hex');
    if(key!==OWNER_HASH)return res.status(403).json({error:'この試作は運営者本人のテスト専用です。'});
    return res.status(200).json({storageKey:'mimiobo-test-v1-'+key});
  }catch{return res.status(503).json({error:'接続を確認できませんでした。時間をおいてお試しください。'});}
};
