const fs=require('node:fs');
const path=require('node:path');
const slug='AnWP6Ox8wWRpOqY1',wid='99a5370c-5fbd-4ceb-9d35-7734d7c580ec';
async function get(url,headers={}){const r=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json()}
(async()=>{
 const {token}=await get('https://cloud.umami.is/analytics/us/api/share/'+slug);
 const headers={'x-umami-share-token':token,'x-umami-share-context':slug};
 const end=Date.now(),week=604800000;
 const result={retrievedAt:new Date(end).toISOString(),periods:{current:{startAt:end-week,endAt:end},previous:{startAt:end-2*week,endAt:end-week-1}},data:{}};
 const tasks=[];
 for(const [period,times] of Object.entries(result.periods)){
  result.data[period]={};
  const base={...times,hostname:'takken2026-quiz.vercel.app',path:'/shindan.html'};
  for(const [key,route,extra] of [['stats','stats',{}],['japan','stats',{country:'JP'}],['events','metrics',{type:'event',limit:100}],['queries','metrics',{type:'query',limit:100}],['referrers','metrics',{type:'referrer',limit:100}]])tasks.push(async()=>{try{result.data[period][key]=await get('https://gateway-us.umami.is/api/websites/'+wid+'/'+route+'?'+new URLSearchParams({...base,...extra}),headers)}catch(e){result.data[period][key]={error:e.message}}});
 }
 let n=0;await Promise.all(Array.from({length:3},async()=>{while(n<tasks.length)await tasks[n++]()}));
 const stamp=new Date(end+9*3600000).toISOString().replace(/[:.]/g,'-').slice(0,19);
 fs.writeFileSync(path.join(__dirname,'umami_診断実測_'+stamp+'.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.message);process.exit(1)});
