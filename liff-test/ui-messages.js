'use strict';
(function(root){
  // Claude owns the final copy. Until B lands, reuse existing preview wording.
  const fallback='本人確認できませんでした。';
  const messages={
    not_allowed:fallback,invalid_line_claims:fallback,invalid_line_token:fallback,
    service_unavailable:fallback,origin_not_allowed:fallback,SESSION_INVALID:fallback,
    'auth:failed':fallback,'auth:unavailable':fallback,'auth:invalid_token':fallback,
    pending:'端末には保存済み・サーバー送信待ち',
    local_conflict:'別の画面で記録が更新されました。この画面の回答は未保存です。',
    local_failed:'保存できませんでした。この画面の回答は未保存です。'
  };
  function text(code){return Object.hasOwn(messages,code)?messages[code]:fallback;}
  root.MimioboMessages={messages,text};
})(typeof window==='object'?window:globalThis);
