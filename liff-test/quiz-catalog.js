'use strict';
// 問題の台帳（本体）。3問チェックの全放送回の問題はここにある。ページ（ep10-preview.html?ep=<n>）・同期（sync.js）・
// サーバーの検証（api/answers.js）・学習カルテ・回の一覧（checks.html）がすべてこのファイルを読む。
// 放送が増えたら、ここに1件足すだけで全部に反映される（取り込みは scripts/import-content.mjs）。
// キーは quizId（ep<回の番号>）。subject は「宅建業法／権利関係／法令上の制限／税・その他」のどれか。
// questions は必ず3問。id は <quizId>-<英小文字・数字>（DB の制約と同じ形）。
// 任意の項目：audioMinutes（音声の長さ・分）、question.hint／pairs（復習の補足）、recommend（結果画面の「次にやること」）。
// 第10回の id・answer・順序は端末とサーバーに保存済みの記録の鍵なので変えない。
//
// scripts/import-content.mjs は DATA_BEGIN〜DATA_END の間だけを書き換える。
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MimioboCatalog=api;
})(typeof window==='object'?window:globalThis,function(){
  return /*DATA_BEGIN*/{
    ep10:{
      episode:10,
      title:'営業保証金と保証協会',
      subject:'宅建業法',
      audioUrl:'https://stand.fm/episodes/69dc7ba498eff95c436a4549',
      audioMinutes:17,
      page:'ep10-preview.html?ep=10',
      questions:[
        {id:'ep10-money',topic:'営業保証金の金額',text:'営業保証金は、主たる事務所につき1,000万円、その他の事務所1か所につき500万円が必要である。',answer:true,explanation:'営業保証金の額は、主たる事務所1,000万円と、その他の事務所1か所につき500万円を合計します。保証協会に納める「弁済業務保証金分担金」の60万円・30万円と区別して確認しましょう。',law:'根拠：宅建業法施行令2条の4・7条',hint:'営業保証金と保証協会に納める分担金。2つの金額を分けて確認します。'},
        {id:'ep10-join',topic:'新規加入時の納付期限',text:'保証協会に加入しようとする宅建業者は、加入した日から2週間以内に弁済業務保証金分担金を納付すればよい。',answer:false,explanation:'新しく加入する場合は、加入しようとする日までに保証協会へ納付します。「2週間以内」は、すでに社員である業者が新たに事務所を設置したときの期限です。',law:'根拠：宅建業法64条の9第1項1号・第2項',hint:'新しく加入するときと事務所を増やすとき。納付期限の違いを確認します。',pairs:[['加入時','加入しようとする日まで'],['増設時','設置した日から2週間以内']]},
        {id:'ep10-add',topic:'事務所増設時の納付期限',text:'保証協会の社員である宅建業者が、分担金納付後に新たに事務所を設置した場合、その日から2週間以内に追加の弁済業務保証金分担金を納付しなければならない。',answer:true,explanation:'事務所を増設した場合は、設置した日から2週間以内に保証協会へ分担金を納付します。新規加入の「加入しようとする日まで」と、場面ごとに分けて覚えます。',law:'根拠：宅建業法64条の9第2項',hint:'「2週間以内」がどの場面の期限か。加入時と比べて確認します。',pairs:[['加入時','加入しようとする日まで'],['増設時','設置した日から2週間以内']]}
      ],
      recommend:{
        intro:'営業保証金の金額と納付期限を確認します。',
        rules:[
          {missed:[1,2],title:'復習：加入時と増設時の期限',body:'新しく加入するときは「加入しようとする日まで」。加入後に事務所を増やすときは「設置した日から2週間以内」です。'},
          {missed:[0],title:'復習：営業保証金と分担金の金額',body:'営業保証金は本店1,000万円・支店1か所500万円。保証協会へ納める分担金は本店60万円・支店1か所30万円です。'}
        ],
        done:{title:'チェック完了',body:'営業保証金の金額と、分担金の納付期限を確認しました。'}
      }
    }
  }/*DATA_END*/;
});
