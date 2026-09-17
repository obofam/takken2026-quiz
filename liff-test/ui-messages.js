'use strict';
(function(root){
  // 文言は Claude 担当（2026-09-17 差し替え）。読点は1文1つまで。煽らない。
  const fallback='ログインを確認できませんでした。もう一度お試しください。';
  const messages={
    not_allowed:'この試作は招待した方だけが使えます。',
    try_later:'メールの送信回数が上限に達しました。しばらくしてからもう一度お試しください。',
    invalid_line_claims:'LINEの確認ができませんでした。LINEでログインし直してください。',
    invalid_line_token:'LINEの確認ができませんでした。LINEでログインし直してください。',
    service_unavailable:'接続できませんでした。時間をおいてもう一度お試しください。',
    origin_not_allowed:'この開き方では保存できません。LINEか公式サイトから開き直してください。',
    SESSION_INVALID:'ログイン情報を確認できませんでした。もう一度ログインしてください。',
    'auth:failed':'メールのリンクを確認できませんでした。もう一度メールを受け取ってください。',
    'auth:unavailable':'接続できませんでした。時間をおいてリンクを開き直してください。',
    'auth:invalid_token':'このリンクは期限切れか使用済みです。もう一度メールを受け取ってください。',
    pending:'端末に保存しました。サーバーへは接続後に送ります。',
    syncing:'保存中',
    synced:'保存しました。',
    unauthorized:'ログインが切れました。もう一度ログインしてください。',
    unavailable:'サーバーに接続できません。端末には保存しています。',
    failed:'送れなかった回答があります。',
    local_conflict:'別の画面で記録が更新されました。この画面の回答は未保存です。',
    local_failed:'保存できませんでした。この画面の回答は未保存です。'
  };
  function text(code){return Object.hasOwn(messages,code)?messages[code]:fallback;}
  root.MimioboMessages={messages,text,fallback};
})(typeof window==='object'?window:globalThis);
