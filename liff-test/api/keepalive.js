'use strict';
const s=require('../lib/server');
// 試し用データベース（Supabase 無料枠）は、使わない日が続くと休止する。毎日1回ここを呼んで、1行だけ読む（vercel.json の crons）。
// 返すのは ok だけ。中身は返さない。
module.exports=s.endpoint(['GET'],async(req,res)=>{
  const rows=await s.supabase('/rest/v1/users?select=id&limit=1');
  if(!Array.isArray(rows))s.fail(503,'database_unavailable');
  return res.status(200).json({ok:true});
});
