const fs=require('node:fs');
const path=require('node:path');
const slug='AnWP6Ox8wWRpOqY1';
const wid='99a5370c-5fbd-4ceb-9d35-7734d7c580ec';
async function json(url,headers={}) {
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('HTTP '+r.status);
 return r.json();
}
(async()=>{
 const {token}=await json('https://cloud.umami.is/analytics/us/api/share/'+slug);
 const headers={'x-umami-share-token':token,'x-umami-share-context':slug};
 const end=Date.now(),week=7*86400000;
 const periods={current:{startAt:end-week,endAt:end},previous:{startAt:end-2*week,endAt:end-week-1}};
 const quiz='takken2026-quiz.vercel.app';
 const pages={tracker:{hostname:'obofam.github.io',path:'/takken2026-quiz/tracker.html'},kyozai:{hostname:quiz,path:'/kyozai.html'},weekly:{hostname:quiz,path:'/weekly.html'},quiz:{hostname:quiz,path:'/'},shindan:{hostname:quiz,path:'/shindan.html'},last30:{hostname:quiz,path:'/30uketori.html'},home:{hostname:'www.mimiobo.com'},homeOld:{hostname:'mimiobo.vercel.app'}};
 const tasks=[];const result={retrievedAt:new Date(end).toISOString(),periods,data:{}};
 for(const [period,times] of Object.entries(periods)) {
  result.data[period]={};
  const add=(key,route,params)=>tasks.push(async()=>{
   try{result.data[period][key]=await json('https://gateway-us.umami.is/api/websites/'+wid+route+'?'+new URLSearchParams({...times,...params}),headers)}catch(e){result.data[period][key]={error:e.message}}
  });
  add('overall','/stats',{}); add('japan','/stats',{country:'JP'});
  for(const type of ['event','query','referrer','country'])add(type,'/metrics',{type,limit:500});
  for(const [name,p] of Object.entries(pages)) {add(name,'/stats',p);add(name+'_jp','/stats',{...p,country:'JP'});}
  add('kyozai_query','/metrics',{...pages.kyozai,type:'query',limit:100});
 }
 let i=0;await Promise.all(Array.from({length:4},async()=>{while(i<tasks.length)await tasks[i++]()}));
 const out=path.join(__dirname,'umami_比較実測_2026-09-07.json');fs.writeFileSync(out,JSON.stringify(result,null,2));
 const summary={retrievedAt:result.retrievedAt,periods};
 for(const [period,d]of Object.entries(result.data)) {
  summary[period]={};
  for(const [key,val] of Object.entries(d)) {
   if(Array.isArray(val))summary[period][key]=key==='event'?val.filter(r=>/last30|30|chokuzen|kyozai|sample|moshi|weekly|mail|kit|substack/.test(r.x)):val;
   else summary[period][key]=val.error?val:{visitors:val.visitors,visits:val.visits,pageviews:val.pageviews,bounces:val.bounces,totaltime:val.totaltime};
  }
 }
 console.log(JSON.stringify(summary,null,2));
})().catch(e=>{console.error(e.message);process.exit(1)});
