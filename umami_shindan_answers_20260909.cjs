const fs=require('node:fs'),path=require('node:path');
const slug='AnWP6Ox8wWRpOqY1',wid='99a5370c-5fbd-4ceb-9d35-7734d7c580ec';
async function get(url,headers={}){const r=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json()}
(async()=>{
 const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'umami_診断実測_2026-09-09T09-51-17.json'),'utf8'));
 const {token}=await get('https://cloud.umami.is/analytics/us/api/share/'+slug);
 const headers={'x-umami-share-token':token,'x-umami-share-context':slug};
 const result={retrievedAt:new Date().toISOString(),periods:snapshot.periods,data:{}};
 const props=['q1_kakomon','q2_tooshi','q3_gyoho','q3_kenri','q3_hourei','q3_zei','q4_jikan','q5_nayami','q6_moshi'];
 const tasks=[];
 for(const [period,times] of Object.entries(result.periods)){
  result.data[period]={};
  for(const propertyName of props)tasks.push(async()=>{try{result.data[period][propertyName]=await get('https://gateway-us.umami.is/api/websites/'+wid+'/event-data/values?'+new URLSearchParams({...times,hostname:'takken2026-quiz.vercel.app',path:'/shindan.html',event:'shindan_complete',propertyName}),headers)}catch(e){result.data[period][propertyName]={error:e.message}}});
 }
 let n=0;await Promise.all(Array.from({length:3},async()=>{while(n<tasks.length)await tasks[n++]()}));
 fs.writeFileSync(path.join(__dirname,'umami_診断アンケート実測_2026-09-09.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.message);process.exit(1)});
