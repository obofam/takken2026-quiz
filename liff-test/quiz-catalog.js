'use strict';
// 問題の台帳。放送が増えたら、ここに1件足すだけで学習カルテに反映される。
// subject は「宅建業法／権利関係／法令上の制限／税・その他」のどれか。
// questions の id・topic・answer は各放送のページ（ep10-preview.html の questions）と一致させる（tests/karte-core.test.cjs が検査）。
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MimioboCatalog=api;
})(typeof window==='object'?window:globalThis,function(){
  return {
    ep10:{
      episode:10,
      title:'営業保証金と保証協会',
      subject:'宅建業法',
      audioUrl:'https://stand.fm/episodes/69dc7ba498eff95c436a4549',
      page:'ep10-preview.html',
      questions:[
        {id:'ep10-money',topic:'営業保証金の金額',answer:true},
        {id:'ep10-join',topic:'新規加入時の納付期限',answer:false},
        {id:'ep10-add',topic:'事務所増設時の納付期限',answer:true}
      ]
    }
  };
});
