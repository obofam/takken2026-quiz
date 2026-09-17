'use strict';
// Small local harness for the Vercel handlers; serves only listed public assets.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.join(__dirname,'..');
const files=new Set(['index.html','ep10-preview.html','plans-preview.html','privacy.html','auth-callback.html','app.js','config.js','style.css','sync.js','auth-client.js','auth-callback.js','ui-messages.js']);
const handlers=Object.fromEntries(['session','answers','email','email-verify','link'].map(name=>['/api/'+name,require('../api/'+name)]));
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.status=n=>{res.statusCode=n;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  try{
    const url=new URL(req.url,'http://localhost');
    if(handlers[url.pathname]){
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000){res.status(413).json({error:'body_too_large'});return;}}
      try{req.body=raw?JSON.parse(raw):{};}catch{return res.status(400).json({error:'invalid_json'});}
      req.query=Object.fromEntries(url.searchParams);return await handlers[url.pathname](req,res);
    }
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!['GET','HEAD'].includes(req.method)||!files.has(name))return res.status(404).json({error:'not_found'});
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
    res.setHeader('Content-Type',types[path.extname(name)]);res.end(req.method==='HEAD'?undefined:await fs.readFile(path.join(root,name)));
  }catch{if(!res.writableEnded)res.status(503).json({error:'unavailable'});}
});
server.listen(3000,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:3000/ep10-preview.html?server=1'));
