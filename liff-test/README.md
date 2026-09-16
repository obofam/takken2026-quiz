# LIFF本人テスト

## 定着3問チェック（2026-09-15追加）

`ep10-preview.html` が現在の本人レビュー用画面。開始ボタンなし、3問スクロール型。localhostではLINEなしのローカルテスト記録を自動保存し、途中回答と再挑戦履歴を復元する。ローカル以外では既存のLIFF本人確認と `/api/session` の運営者限定検証後、本人別のブラウザー保存先を使う接続コードを追加済み。今回の更新配信・実LINEテストは未実施。サーバーDB・別端末同期なし。既存 `index.html` の旧接続検証画面は維持。

保存コードはHTML内に保持し、`tests/progress.test.cjs` が該当部分を読み込んで検証する。`npm test` で既存認証3件と保存7件を実行。詳細は `../../0_全体戦略/宅建2.0_要件定義03_自動保存と本人確認.md`。

---

2026-09-15。既存サイトとは別のVercelプロジェクトに配置する試作。親の.vercelignoreでliff-test/を除外。本番LINEの配信・Webhook・メニューは変更しない。

- LINE Login channel: 2011606963（開発中を維持）
- LIFF scope: openidのみ。profile/chat_message.write/emailは不要。
- api/session.jsでLINE公式にIDトークンを検証し、aud/iss/expと運営者IDのSHA256を確認する。シークレット不要。トークンをログ・URL・localStorageに出さない。
- 学習履歴は本人確認後、ブラウザー内にのみ保存。DB同期・AI分析・問題回答の自動取り込みは未実装。
- 提案は学習段階/時間/ペースの固定ルールであり、AI分析・弱点診断とは表示しない。
- 既存教材へのリンク以外は独立。受講生データなし。
- 更新する際は、このディレクトリのみをデプロイし、親サイトをデプロイしない。
- テスト: node --test tests/auth.test.cjs

## 配置と本人確認
- 独立Vercelプロジェクト: mimiobo-liff-test（prj_9bpddkVfqXMaYzVr2SszHO8bSIKP）
- エンドポイント: https://mimiobo-liff-test.vercel.app/
- 起動URL: https://liff.line.me/2011606963-hH0DzETc
- 今回の確認目標: 本人が初回連携し、提案を見て、自分で記録できること。売上や学習効果の検証は次段階。
- 実機での初回同意と本人認証成功は運営者本人による確認待ち。
