'use strict';
// 回のページの「登録済の方はこちら」の入口と、ログインの画面の戻り先（next）。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),prod=path.join(root,'..');
const read=p=>fs.readFileSync(p,'utf8');
const login=read(path.join(prod,'login/index.html')),cb=read(path.join(prod,'auth-callback.js'));
const re=src=>{const m=src.match(/\/\^\(\\\/ep\\\/\\d\{1,3\}\|\\\/roadmap\|\\\/kounyu\\\.html\)\$\//);assert.ok(m,'許可リストの正規表現');return new RegExp(m[0].slice(1,-1));};

test('login next: only /ep/<digits>, /roadmap and /kounyu.html are accepted (login page and auth-callback use the same rule)',()=>{
  for(const r of [re(login),re(cb)]){
    for(const ok of ['/ep/2','/ep/10','/ep/999','/roadmap','/kounyu.html'])assert.ok(r.test(ok),ok);
    for(const ng of ['//evil.example','https://evil.example/ep/2','/ep/2/../x','/api/session','/ep/abc','/ep/','/ep/2?x=1','/ep/2/','/roadmap/x','/ep/1234','','ep/2','/\\evil','/ep/2\n/x','/kounyu','/kounyuXhtml','/kounyu.html?x=1','/kounyu.html/','/kounyu.htmlx','//evil.example/kounyu.html','/x/kounyu.html'])assert.ok(!r.test(ng),JSON.stringify(ng));
  }
  // 売り場から来てログイン済みなら、LINEの外でもそのまま売り場へ戻る（回のページ・ロードマップは今までどおり戻さない）
  assert.match(login,/if \(NEXT === '\/kounyu\.html' && r\.json\.userId\) \{ location\.replace\(NEXT\); return; \}/);
  assert.match(login,/if \(NEXT && inLine\) \{ location\.replace\(NEXT\); return; \}/);
  assert.match(login,/liff\.line\.me\/' \+ LIFF_ID \+ NEXT/);// LINEで開く：next があるときだけ LIFF の住所＋next
  assert.match(login,/id="lineLink" href="https:\/\/liff\.line\.me\/2012583516-7vmvMorb\/roadmap"/);// 無いときは今までどおり
  assert.match(login,/localStorage\.setItem\(NEXT_KEY/);assert.match(cb,/takken2027-login-next/);
  assert.match(cb,/let target='\/roadmap'/);// 既定の行き先は変えない
  assert.match(login,/<p class="or" id="mailNote" hidden>メールで受け取っている方は、メールの中のリンクから開くと、続きが出ます。<\/p>/);
  assert.match(login,/mailNote'\)\.hidden = !\/\^\\\/ep\\\/\/\.test\(NEXT\)/);// /ep/ のときだけ出す
});
test('ep pages: 3 entrances for the not-registered view (top row, figure box, past-exam box), same link, ep-login event',()=>{
  for(const [dir,mk] of [[prod,n=>'/login?next=/ep/'+n],[root,()=>'/account.html']]){
    for(let n=1;n<=9;n++){
      const h=read(path.join(dir,'ep',String(n),'index.html'));
      const href=mk(n);
      const a=`<a href="${href}" data-umami-event="ep-login" data-umami-event-ep="${n}">登録済の方はこちら</a>`;
      assert.equal(h.split(a).length-1,3,'ep'+n+' '+dir);
      assert.ok(h.includes(`<span class="top-login only-a${n===1?' top-login2':''}">無料ページ（${a}）</span>`),'top '+n);
      assert.equal((h.match(/<p class="login-line">/g)||[]).length,2);
      // 図の下の囲み・過去問1選の囲みの中（どちらも only-a）
      assert.match(h,/<div class="next-box only-a" id="zukai-next">[\s\S]*?<p class="login-line">[\s\S]*?<\/div>/);
      assert.match(h,/<div class="next-box only-a"><p>[\s\S]*?<p class="login-line">[\s\S]*?<\/div>\s*<div class="slot" id="slot-kk">/);
      // 登録なしの見え方だけ：LINE・メール（is-friend）・購入者（is-buyer）では .only-a ごと出ない。第1回以外は、配信前の閉じた画面でも出ない
      assert.match(h,/\.is-friend \.only-a\{display:none !important\}/);
      assert.doesNotMatch(h,/\.only-a\{display:(?!none)/);
      if(n>1)assert.match(h,/\.ep-closed \.top-login\{display:none\}/);
    }
  }
  assert.match(read(path.join(prod,'ep/_shared/text-view.css')),/\.is-buyer \.only-a,\.is-buyer \.line-card\{display:none !important\}/);
  // 試し用の型は account.html を指す（試し用には /login が無い）。本番の型は /login?next=
  assert.ok(!fs.existsSync(path.join(root,'login')));
});
