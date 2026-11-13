// 202611130002_open_login.sql：p_open を渡したときだけ許可リストを見ない。渡さなければ今までどおり。
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
test('open_login migration: resolve_identity / save_answer',async()=>{
  const db=new PGlite(),root=path.resolve(__dirname,'..'),mig=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
  try{
    await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public to anon, authenticated, service_role;`);
    for(const n of ['202609170001_sprint1.sql','202610060001_sprint2.sql','202610060002_sprint4_catalog.sql','202611110001_text_plan.sql','202611120001_products_2027.sql','202611130001_progress.sql','202611130002_open_login.sql'])await db.exec(mig(n));
    const err=async sql=>{try{await db.query(sql);return null;}catch(e){return String(e.message);}};
    // 許可リストにいない人：p_open なしは拒否、p_open=true は通る
    assert.match(await err("select public.resolve_identity('line','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')"),/identity_not_allowed/);
    const id=(await db.query("select public.resolve_identity('line','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',null,true) as id")).rows[0].id;
    assert.match(id,/^[0-9a-f-]{36}$/);
    // 同じ人でも、p_open なしで呼べば（許可リストにいないので）拒否のまま
    assert.match(await err("select public.resolve_identity('line','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')"),/identity_not_allowed/);
    // 回答の保存：許可リスト外の人は p_open なしだと拒否、p_open=true だと保存できる
    const call=open=>`select public.save_answer('${id}','00000000-0000-4000-8000-0000000000b1','ep10',now(),'ep10-money',true,now()${open?',true':''})`;
    assert.match(await err(call(false)),/user_not_allowed/);
    assert.equal(await err(call(true)),null);
    assert.equal((await db.query('select count(*)::int as n from public.answers')).rows[0].n,1);
    // 許可リストにいる人は、これまでどおり p_open なしで通る
    await db.exec("insert into public.allowlist(provider,subject) values ('line','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')");
    await db.query("select public.resolve_identity('line','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')");
  }finally{await db.close();}
});
