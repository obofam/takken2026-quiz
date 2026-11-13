// 202611130003_merge_users.sql：両方に利用者の行がある場合も、合図があれば1人にまとめる（古いほうを残す）。
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const LINE='a'.repeat(64),LINE2='b'.repeat(64),MAIL='tester@example.com',MAIL2='other@example.com';
const T1='1'.repeat(64),T2='2'.repeat(64),T3='3'.repeat(64);
const U1='00000000-0000-4000-8000-000000000001',U2='00000000-0000-4000-8000-000000000002';
const FN='public.resolve_identity(text,text,text,boolean)';
async function setup(){
  const db=new PGlite(),root=path.resolve(__dirname,'..'),mig=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public to anon, authenticated, service_role;`);
  for(const n of ['202609170001_sprint1.sql','202610060001_sprint2.sql','202610060002_sprint4_catalog.sql','202611110001_text_plan.sql','202611120001_products_2027.sql','202611130001_progress.sql','202611130002_open_login.sql','202611130003_merge_users.sql'])await db.exec(mig(n));
  const err=async sql=>{try{await db.query(sql);return null;}catch(e){return String(e.message);}};
  const one=async sql=>(await db.query(sql)).rows[0];
  // U1=LINE の利用者、U2=メールの利用者。oldFirst=true なら U1 のほうが古い。
  const users=async(oldFirst=true)=>{
    const a=oldFirst?'2026-01-01':'2026-02-01',b=oldFirst?'2026-02-01':'2026-01-01';
    await db.exec(`insert into public.users(id,created_at) values ('${U1}','${a}'),('${U2}','${b}');
      insert into public.identities values ('${U1}','line','${LINE}'),('${U2}','email','${MAIL}');`);
  };
  const ticket=(hash,user,provider,subject,expires="now() + interval '10 minutes'")=>db.exec(`insert into public.link_tickets values ('${hash}','${user}','${provider}',${subject?`'${subject}'`:'null'},${expires})`);
  const resolve=(provider,subject,hash=null)=>one(`select public.resolve_identity('${provider}','${subject}',${hash?`'${hash}'`:'null'},true) as id`);
  return {db,err,one,users,ticket,resolve};
}
const count=async(h,t)=>(await h.one(`select count(*)::int as n from public.${t}`)).n;

test('実機の状態：LINE側に記録、メール側は空 → 古いほうに全部そろい、もう一方は消える',async()=>{
  const h=await setup();try{
    await h.users(true);
    await h.db.exec(`insert into public.progress(user_id,listened,done) values ('${U1}','{"1":1,"2":2}','{"1":true}');
      insert into public.entitlements(user_id,plan,source) values ('${U1}','take','stripe:x');`);
    await h.ticket(T1,U2,'line',null);
    const r=await h.resolve('line',LINE,T1);
    assert.equal(r.id,U1);
    assert.equal(await count(h,'users'),1);
    assert.equal((await h.one(`select count(*)::int n from public.identities where user_id='${U1}'`)).n,2);
    const p=await h.one(`select listened,done from public.progress where user_id='${U1}'`);
    assert.deepEqual(p.listened,{1:1,2:2});assert.deepEqual(p.done,{1:true});
    assert.equal((await h.one(`select count(*)::int n from public.entitlements where user_id='${U1}'`)).n,1);
    assert.equal(await count(h,'link_tickets'),0);
    // 同じ合図をもう一度：無効
    assert.match(await h.err(`select public.resolve_identity('line','${LINE}','${T1}',true)`),/invalid_link_ticket/);
    assert.equal(await count(h,'users'),1);
  }finally{await h.db.close();}
});
test('メール側のほうが古い場合は、メール側の利用者を残す',async()=>{
  const h=await setup();try{
    await h.users(false);
    await h.db.exec(`insert into public.progress(user_id,listened) values ('${U1}','{"3":1}')`);
    await h.ticket(T1,U2,'line',null);
    assert.equal((await h.resolve('line',LINE,T1)).id,U2);
    assert.deepEqual((await h.one(`select listened from public.progress where user_id='${U2}'`)).listened,{3:1});
    assert.equal((await h.one(`select count(*)::int n from public.users where id='${U1}'`)).n,0);
  }finally{await h.db.close();}
});
test('progress の合わせ方：listened は大きいほう、done は和集合',async()=>{
  const h=await setup();try{
    await h.users(true);
    await h.db.exec(`insert into public.progress(user_id,listened,done) values ('${U1}','{"1":1,"2":2,"4":1}','{"1":true}'),('${U2}','{"1":2,"2":1,"5":2}','{"3":true}')`);
    await h.ticket(T1,U2,'line',null);
    await h.resolve('line',LINE,T1);
    const p=await h.one(`select listened,done from public.progress where user_id='${U1}'`);
    assert.deepEqual(p.listened,{1:2,2:2,4:1,5:2});assert.deepEqual(p.done,{1:true,3:true});
    assert.equal(await count(h,'progress'),1);
    assert.equal((await h.one(`select public.progress_map_ok('listened',listened) a, public.progress_map_ok('done',done) b from public.progress`)).a,true);
  }finally{await h.db.close();}
});
test('attempts・answers が残る利用者へ移る',async()=>{
  const h=await setup();try{
    await h.users(true);
    const A1='aaaaaaaa-0000-4000-8000-000000000001',A2='aaaaaaaa-0000-4000-8000-000000000002';
    await h.db.exec(`insert into public.attempts values ('${A1}','${U1}','ep10',now()),('${A2}','${U2}','ep10',now());
      insert into public.answers(attempt_id,user_id,quiz_id,question_id,value,answered_at) values
      ('${A1}','${U1}','ep10','ep10-money',true,now()),('${A2}','${U2}','ep10','ep10-money',false,now()),('${A2}','${U2}','ep10','ep10-join',true,now())`);
    await h.ticket(T1,U1,'email',MAIL);   // 合図の持ち主 U1 に、別の利用者 U2 のメール識別をつなぐ形
    await h.resolve('email',MAIL,T1);
    assert.equal(await count(h,'users'),1);
    assert.equal((await h.one(`select count(*)::int n from public.attempts where user_id='${U1}'`)).n,2);
    assert.equal((await h.one(`select count(*)::int n from public.answers where user_id='${U1}'`)).n,3);
  }finally{await h.db.close();}
});
test('同じ provider の識別を両方が持つ場合は identity_conflict で何も変わらない',async()=>{
  const h=await setup();try{
    await h.users(true);
    await h.db.exec(`insert into public.identities values ('${U1}','email','${MAIL2}');
      insert into public.progress(user_id,listened) values ('${U1}','{"1":1}'),('${U2}','{"2":1}')`);
    await h.ticket(T1,U2,'line',null);   // U2(メール) が LINE をつなぐ。LINE は U1 のもの。U1 もメールを持つ → 衝突
    assert.match(await h.err(`select public.resolve_identity('line','${LINE}','${T1}',true)`),/identity_conflict/);
    assert.equal(await count(h,'users'),2);assert.equal(await count(h,'progress'),2);
    assert.equal((await h.one(`select count(*)::int n from public.identities where user_id='${U2}'`)).n,1);
    assert.equal(await count(h,'link_tickets'),1);
  }finally{await h.db.close();}
});
test('合図なし・期限切れ・別 provider の合図ではまとめない',async()=>{
  const h=await setup();try{
    await h.users(true);
    assert.equal((await h.resolve('line',LINE)).id,U1);
    await h.ticket(T1,U2,'line',null,"now() - interval '1 minute'");
    assert.match(await h.err(`select public.resolve_identity('line','${LINE}','${T1}',true)`),/invalid_link_ticket/);
    await h.ticket(T2,U2,'email',null);
    assert.match(await h.err(`select public.resolve_identity('line','${LINE}','${T2}',true)`),/invalid_link_ticket/);
    assert.match(await h.err(`select public.resolve_identity('line','${LINE}','${T3}',true)`),/invalid_link_ticket/);
    assert.equal(await count(h,'users'),2);
    // 新しい LINE 識別は、合図の持ち主につながるだけ（今までどおり）
    await h.ticket(T3,U2,'line',null);
    assert.equal((await h.resolve('line',LINE2,T3)).id,U2);assert.equal(await count(h,'users'),2);
  }finally{await h.db.close();}
});
test('権限：anon・authenticated は resolve_identity を実行できない',async()=>{
  const h=await setup();try{
    for(const role of ['anon','authenticated'])assert.equal((await h.one(`select has_function_privilege('${role}','${FN}','execute') a`)).a,false);
    assert.equal((await h.one(`select has_function_privilege('service_role','${FN}','execute') a`)).a,true);
  }finally{await h.db.close();}
});
