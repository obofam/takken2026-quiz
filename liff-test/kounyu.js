'use strict';
// やさしいテキストの売り場。値段・権利はすべて /api/products から。
// 上半分は DOM を使わない純粋な部分（状態の決め方・書式）。下半分が描画と通信。
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MimioboKounyu=api;
})(typeof self!=='undefined'?self:this,function(){
  const PRODUCT='text';
  const PROD_HOST='takken.mimiobo.com';
  const POLL_MS=2000,POLL_MAX=15;
  const LOGIN_HINT='takken2027-login-hint';

  function yen(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'円';}
  function parts(iso){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||''));return m?{y:+m[1],m:+m[2],d:+m[3]}:null;}
  function dateLong(iso){const p=parts(iso);return p?p.y+'年'+p.m+'月'+p.d+'日':'';}
  function dateShort(iso){const p=parts(iso);return p?p.m+'月'+p.d+'日':'';}
  function isProdHost(host){return host===PROD_HOST;}
  // 見本のページは本番にだけある。
  function samplePath(host){return isProdHost(host)?'/ep/1/text':'https://'+PROD_HOST+'/ep/1/text';}
  function roadmapPath(host){return isProdHost(host)?'/roadmap':'/roadmap-an3.html';}
  // 試し用と本番でログインの入口が違う。戻り先（next）は入口側が対応したら効く。
  function loginPath(host){return isProdHost(host)?'/login?next=/kounyu.html':'/account.html?next=kounyu';}

  // 値段のカードの中身（行の並び）
  function priceLines(offer,validUntil,loggedIn){
    if(!offer||typeof offer.price!=='number')return null;
    const out={early:false,was:'',off:'',amount:'',note:'',lines:[]};
    if(offer.kind==='start'){
      out.early=true;out.amount=yen(offer.price);
      out.was=yen(offer.listPrice);out.off=yen(offer.listPrice-offer.price)+'OFF';
      if(offer.basis==='open'&&offer.until)out.note=dateLong(offer.until)+'までは、どなたでもこの価格です。以降は、登録から7日間が対象です。';
      else if(offer.basis==='touroku'&&offer.until)out.note='登録から7日間は、この価格でご購入いただけます。（'+dateShort(offer.until)+'まで）';
    }else{
      out.amount=yen(offer.price);
      if(!loggedIn&&typeof offer.startPrice==='number')out.lines.push('登録から7日間は、早割 '+yen(offer.startPrice)+' でご購入いただけます。対象かどうかは、ログイン後に表示されます。');
    }
    if(validUntil)out.lines.push('利用期間は、'+dateLong(validUntil)+'（本試験日）までです。');
    out.lines.push('お支払いはクレジットカードです。決済はStripeの画面で行います。');
    return out;
  }

  // 画面の状態を1つに決める。
  // input: {data:/api/products の本文|null, failed:boolean, loaded:boolean, checkout:'ok'|'cancel'|null,
  //         verify:'checking'|'ok'|'slow'|null, host, boughtNow:boolean(409で購入ずみと分かった)}
  function decide(input){
    const host=input.host||'';
    const v={state:'loading',trial:!isProdHost(host),thanks:null,cancel:false,price:null,button:null,priceError:false,owned:false,roadmap:roadmapPath(host),login:loginPath(host)};
    if(input.checkout==='ok'&&input.verify)v.thanks=input.verify;
    if(input.checkout==='cancel')v.cancel=true;
    if(!input.loaded)return v;
    const d=input.data;
    if(input.failed||!d||!Array.isArray(d.products)){v.state='error';v.priceError=true;return v;}
    const owned=Array.isArray(d.owned)&&d.owned.indexOf(PRODUCT)>=0||!!input.boughtNow;
    if(owned){v.state='owned';v.owned=true;return v;}
    v.state=d.loggedIn?'member':'guest';
    v.price=priceLines(d.offers&&d.offers[PRODUCT],d.validUntil,!!d.loggedIn);
    if(!v.price){v.priceError=true;return v;}
    v.button=d.loggedIn?'buy':'login';
    return v;
  }

  const core={LOGIN_HINT,samplePath,PRODUCT,POLL_MS,POLL_MAX,yen,dateLong,dateShort,isProdHost,roadmapPath,loginPath,priceLines,decide};

  // ---- ここから下はブラウザだけ ----
  if(typeof document==='undefined')return core;
  const $=id=>document.getElementById(id);
  const qs=new URLSearchParams(location.search);
  const S={data:null,failed:false,loaded:false,checkout:qs.get('checkout'),verify:null,boughtNow:false,buyError:false,busy:false};
  if(S.checkout==='ok')S.verify='checking';

  function txt(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=text;return e;}
  function link(cls,href,text){const a=txt('a',cls,text);a.href=href;return a;}
  function clear(e){while(e.firstChild)e.removeChild(e.firstChild);}

  const STATIC_AMOUNT=$('price')&&$('price').firstElementChild?$('price').firstElementChild.cloneNode(true):null;

  function render(){
    const v=decide({data:S.data,failed:S.failed,loaded:S.loaded,checkout:S.checkout,verify:S.verify,host:location.hostname,boughtNow:S.boughtNow});
    // 買ったあと
    const th=$('thanks');clear(th);th.hidden=!v.thanks;
    if(v.thanks==='checking'){th.className='card';th.appendChild(txt('p','plain small','購入を確認しています。'));}
    else if(v.thanks==='ok'){
      th.className='card done-card';
      th.appendChild(txt('h2','','ご購入ありがとうございます'));
      th.appendChild(txt('p','','やさしいテキストをご利用いただけます。各回のページを開くと、テキストが表示されます。'));
      const row=txt('div','btns','');row.appendChild(link('btn primary','/ep/1/','第1回を開く'));row.appendChild(link('btn ghost',v.roadmap,'学習ロードマップ'));th.appendChild(row);
    }else if(v.thanks==='slow'){
      th.className='card';
      th.appendChild(txt('p','','反映に時間がかかっています。1分ほどおいて、このページを再読み込みしてください。'));
      const p=txt('p','small','');p.appendChild(document.createTextNode('再読み込みしても変わらない場合は、'));p.appendChild(link('','https://www.mimiobo.com/tokushoho','お問い合わせ'));p.appendChild(document.createTextNode('ください。'));th.appendChild(p);
    }
    // 値段・ボタン・購入ずみ
    $('cancel').hidden=!v.cancel;
    $('priceCard').hidden=v.owned;
    $('trial').hidden=!v.trial||!v.price;
    const pc=$('price');
    // 読み込み中は、HTML に最初からある通常価格の表示をそのまま残す
    if(v.state!=='loading')clear(pc);
    const ownBox=$('owned');ownBox.hidden=!(v.owned&&v.thanks!=='ok');
    const buy=$('buy');clear(buy);
    pc.hidden=true;
    if(v.state==='loading'){pc.hidden=false;}
    else if(v.priceError){pc.hidden=false;if(STATIC_AMOUNT)pc.appendChild(STATIC_AMOUNT.cloneNode(true));pc.appendChild(txt('p','plain small err','価格を読み込めませんでした。時間をおいて、再読み込みしてください。'));}
    else if(v.price){
      pc.hidden=false;
      const am=txt('p','price-amount',v.price.amount.replace(/円$/,''));am.appendChild(txt('span','','円（税込）'));
      if(v.price.early){
        const row=txt('div','price-row','');
        row.appendChild(txt('p','price-was',v.price.was));
        const off=txt('p','price-off','');off.appendChild(txt('small','','早割'));off.appendChild(document.createTextNode(v.price.off));row.appendChild(off);
        row.appendChild(txt('i','price-arrow',''));
        row.appendChild(am);pc.appendChild(row);
      }else pc.appendChild(am);
      if(v.price.note)pc.appendChild(txt('p','price-note',v.price.note));
      const ul=txt('ul','notes','');v.price.lines.forEach(t=>ul.appendChild(txt('li','',t)));pc.appendChild(ul);
      if(v.button==='login'){
        pc.appendChild(link('btn primary block',v.login,'ログインして購入する'));
        pc.appendChild(txt('p','small center','LINEまたはメールでログインできます。登録無料です。'));
      }else if(v.button==='buy'){
        const b=txt('button','btn primary block','購入手続きへ');b.type='button';b.id='buyBtn';b.disabled=S.busy;
        b.addEventListener('click',()=>purchase());pc.appendChild(b);
        if(S.buyError)pc.appendChild(txt('p','small err center','決済画面を開けませんでした。時間をおいて、もう一度お試しください。'));
      }
    }
  }

  function getJson(path,opt){
    opt=opt||{};opt.credentials='same-origin';opt.cache='no-store';
    return fetch(path,opt).then(r=>r.json().catch(()=>({})).then(j=>({status:r.status,json:j||{}})));
  }
  function readProducts(){
    return getJson('/api/products').then(r=>{
      if(r.status!==200||!Array.isArray(r.json.products)){S.failed=true;S.data=null;}
      else{S.failed=false;S.data=r.json;markLogin(r.json);}
      S.loaded=true;
    }).catch(()=>{S.failed=true;S.data=null;S.loaded=true;});
  }
  // 回のページ（progress-sync.js の cookieHint）は、このブラウザでログインした印があるときだけサーバーにログインを確かめる。
  // 売り場でログインが確かめられたら、同じ印を付ける（買ったあと、回のページがテキストに切り替わるように）。鍵の名前は progress-sync.js の K_H と同じ。
  function markLogin(d){if(d&&d.loggedIn===true){try{localStorage.setItem(LOGIN_HINT,'1');}catch(_){}}}
  function isOwned(){return !!(S.data&&Array.isArray(S.data.owned)&&S.data.owned.indexOf(PRODUCT)>=0);}

  function purchase(){
    if(S.busy)return;
    S.busy=true;S.buyError=false;render();
    const fail=()=>{S.busy=false;S.buyError=true;render();};
    getJson('/api/session').then(s=>{
      if(s.status===401||!s.json.userId){location.href=loginPath(location.hostname);return;}
      return getJson('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json','X-Mimiobo-User':s.json.userId},body:JSON.stringify({product:PRODUCT})}).then(r=>{
        if(r.status===200&&r.json.url){location.href=r.json.url;return;}
        if(r.status===401){location.href=loginPath(location.hostname);return;}
        if(r.status===409){S.busy=false;S.boughtNow=true;render();return;}
        fail();
      });
    }).catch(fail);
  }

  function verifyLoop(tries){
    if(isOwned()){
      S.verify='ok';
      try{const u=new URL(location.href);u.searchParams.delete('checkout');u.searchParams.delete('product');history.replaceState(null,'',u.pathname+(u.search||'')+u.hash);}catch(_){}
      render();return;
    }
    if(tries>=POLL_MAX){S.verify='slow';render();return;}
    setTimeout(()=>{readProducts().then(()=>{render();verifyLoop(tries+1);});},POLL_MS);
  }

  function start(){
    const sm=$('sample');if(sm)sm.href=samplePath(location.hostname);
    render();
    readProducts().then(()=>{
      render();
      if(S.checkout==='ok')verifyLoop(0);
    });
  }
  start();
  return core;
});
