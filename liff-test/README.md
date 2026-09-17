# LIFF本人テスト・Sprint 1

## 2026-09-17 の状態

共通ログインAPI、単回の連携チケット、回答の1行保存・復元、端末内再送キューを実装。画面の見た目・文言・問題・比較ページは変更していない。デプロイ・実メール送信は未実施。

**まだ「デプロイ可」ではない。** 次の依存が残る。

- Supabase接続は確認済み。`allowlist` の読み取りは HTTP 404 で、今回のスキーマは未適用。下記SQLをテスト用プロジェクトに適用する。
- メール入力／送信結果／LINE連携確認／認証失敗／同期状態の画面と `privacy.html` のサーバー保存案内は **Claudeで**。指示書§0の「画面の見た目と文言は Claude の担当」、§4の文面依頼に従い、新しい画面文言は足していない。
- Supabaseメールテンプレート・許可Redirect URL設定と実機一周確認が未了。
- ローカル `.env.local` に既存チャネルの `LINE_CHANNEL_ID` を補完済み。Vercel側にも同名を設定する。Vercel環境設定は変更していない。

同期は検証用の `/ep10-preview.html?server=1` でのみ有効。通常URL／localhostの従来端末内試作は維持。サーバー保存案内が完成してからClaudeが標準導線を接続する。既存の「このブラウザーに保存／別端末同期なし」は検証モードに合わないため、そのまま配布しない。

## 作業チェック

- [x] 共通Cookie、LINE公式検証、メールトークンのサーバー検証、許可リスト
- [x] 許可された本人間のメール→LINE／LINE→メール連結API
- [x] 回答POST、所有者ごとのGET、重複保存防止、オフライン再送
- [x] ローカルDBで移行・権限・連携・保存の回帰検証
- [ ] テストSupabaseへSQL適用・Auth設定
- [ ] Claudeのログイン／連携／保存状態UI・privacy案内
- [ ] 実メール・LINE・別ブラウザでの手動確認
- [ ] 上記完了後、KeiまたはClaudeがデプロイ判断

## セットアップ（テスト環境のみ）

環境変数は `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET`（32バイト以上）, `LINE_CHANNEL_ID`（既存値 `2011606963`）。新しい `sb_secret_` キーを使用し、旧 service_role JWT は使わない。`VERCEL_URL` / `VERCEL_BRANCH_URL` はプレビューのOrigin検証にVercel自動設定値を使う。秘密値はログ・チャット・gitに出さない。

1. Supabase SQL Editorで `supabase/migrations/202609170001_sprint1.sql` を適用する。新規7テーブルと2RPCを作成する一回限りの移行。既存スキーマを削除／置換しない。
2. 続いて `supabase/allowlist.local.sql` を適用する。今回指定されたメールと既存のKei本人LINEハッシュを登録済みのローカル専用ファイル。gitとVercel配信から除外している。未登録者のメール送信・ログイン・保存は拒否する。
3. Supabase AuthのRedirect URLsに `https://mimiobo-liff-test.vercel.app/auth-callback.html` を追加する。ローカル検証時のみ `http://127.0.0.1:3000/auth-callback.html` も追加。プレビューURLを使う場合はその正確なコールバックURLを登録する。
4. Magic LinkとConfirm signupメールテンプレートのリンク先を `{{ .RedirectTo }}#token_hash={{ .TokenHash }}` にする。**テンプレートの本文はClaude担当**。既定の `ConfirmationURL` は使わない（ブラウザへSupabase access/refresh tokenを渡さないため）。メールプロバイダーの追跡リンク機能は無効にする。Supabaseの既定メール送信制限／宛先制限によりSMTP設定が必要な場合がある。
5. メールは要求したブラウザで10分以内に開く。要求時のhttpOnly Cookieと検証済みメールの一致を確認するため、別ブラウザでは拒否する。別端末でログインするときは、その端末で改めてメールを要求する。LINEアプリからメールを連結する場合も、LINEログイン済みの同じブラウザでリンクを開く必要がある。失敗時の案内はClaudeのUIで実装する。

Supabase secret keyはData API用で、今回の環境にはSQL適用用DB接続情報／管理API接続がない。ログイン済み管理画面での適用・Auth設定はプロジェクト分担どおり **Claudeで**。

## 実装の構成

- `lib/server.js`: Supabase REST、HMAC-SHA256セッション、Origin/JSON検査、許可リスト再確認。CookieはHttpOnly / SameSite=Lax / HTTPSでSecure、7日。トークンや上流エラーの生データは返さない。Cookieは署名済みで暗号化ではない。
- `api/session.js`: LINEのID tokenを公式verify endpointで検証、aud/iss/expを照合。利用者UUIDに対応するCookieを発行。GETで復元、DELETEで当ブラウザをログアウト。
- `api/email.js`, `api/email-verify.js`: 許可メールにOTPリンクを要求、hashをサーバーで交換し `GET /auth/v1/user`（`auth.getUser`相当）で本人メールを検証。Supabaseのセッショントークンはブラウザに返さない。
- `api/link.js`: ログイン中の本人に、10分有効のLINE連携チケットを発行。DBにはSHA256だけを保存。消費・identity追加は単一トランザクション。既に別利用者IDのidentityは409として拒否し、自動統合しない。**初回から連結操作で第2の入口を通ること**。両方で独立ログイン済みの場合の統合は別途検討。
- `api/answers.js`: 本人IDはCookieから取得。POSTは `X-Mimiobo-User` がCookieのIDと一致しなければ拒否し、別タブのアカウント切替による混入を防ぐ。同一attempt/questionは最初のサーバー回答を採用。GETは所有者で絞り500件ずつ取得、1000attempt超は黙って切らずエラー。
- `supabase/`: 全テーブルRLSとブラウザロールの権限剥奪。secret keyが対応するサーバーロールだけが利用。空のentitlements以外のStripe処理はない。
- `sync.js`: 本人IDごとのキュー、回答ごとのPOST、読込時GET、競合時サーバー優先。新たに答えた行だけ送る。旧ローカル履歴を本人の確認なく取り込まない。再挑戦の未回答attemptは端末内だけで保持し、最初の回答時にサーバーへ作る。

SDK依存を増やさずNode標準fetchでRESTを呼ぶ構成にした。PGliteは開発テスト専用で本番APIからimportしない。`PROGRESS_STORE` / `KARTE_SUMMARY`の保護区間は変更していない。

端末内キャッシュキーは共通UUID由来に変更。旧LINEハッシュの保存領域は削除せず、未確認の過去回答を自動移行しない。通信が途切れた認証済みの開いている画面では回答を端末に保持し、再接続／フォーカスで再送する。オフラインで新規ロードした場合は本人確認できないのでサーバーモードの回答を有効にしない。

## Claudeの画面への接続契約

`auth-client.js` に文言なしの `window.MimioboAuth` を用意。

- `await MimioboAuth.email(address)`：ログインメールを要求。
- `await MimioboAuth.email(address, {link:true})`：現在の利用者にメールを結ぶ。認証済みCookie必須。
- `await MimioboAuth.linkLine()`：連携用LIFF URLを返す。本人が連携を選んだ後にだけ開く。リンク先ではLINE本人確認ボタンの操作が必要。**誰の記録にLINEを結ぶかの確認・同意UIをClaudeが仕上げてから公開する**。リンクの転送・共有はさせない。
- `await MimioboAuth.line(liff.getIDToken())`：LINE本人検証とチケット消費。既存ページから接続済み。
- `await MimioboAuth.logout()`：当ブラウザのCookieを削除。UI側で記録表示も閉じる。他の端末やコピーされた有効Cookieの強制失効は対象外。
- `mimiobo:sync` CustomEventの `event.detail.state` / `html[data-sync-state]`：`syncing` / `pending` / `synced` / `unauthorized`。初期接続不能は `unavailable`。既存の保存文言は端末保存を指しており、サーバーへの到達はこの状態で区別する。
- コールバック失敗は `?server=1&auth=failed` 等へ戻す。失敗理由に応じた再送案内・メール入力UIは未実装。APIの `error` は内部コードなので利用者へそのまま表示しない。

LIFFは既存ID `2011606963-hH0DzETc`、エンドポイント `https://mimiobo-liff-test.vercel.app/` を維持。初回ルートの `liff.state` 処理中に旧appが別利用者を作らないようガードした。チケットは二次リダイレクト後のfragmentから取り込み、SDK初期化後にURLを消す。実LINEでのリダイレクト・連携は未検証。

## ローカル起動と自動検証

このフォルダで通常は `npm ci` → `npm test`、API付き起動は `npm run dev`。ローカルハーネスは127.0.0.1:3000のみで待ち受け、配信するファイルを列挙し `.env` やSQLは配信しない。

今回のPCはnpmラッパーが存在しないRoaming配下のnpmを参照したため、インストール済み本体を直接使用した（npm自体のシステム設定は変えていない）：

```powershell
Set-Location 'C:\Claude\宅建\7_クイズと進捗トラッカー\liff-test'
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' test
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run dev
```

テストは既存13件の意図を維持（GET sessionは新仕様に更新）し、署名改ざん・期限・Origin・許可撤回・メール照合・所有者・同期・DB権限を追加。DBテストはメモリ内Postgres(PGlite)にSupabase相当ロールを作り、実際の移行とSQL回帰を実行する。Supabase Auth／PostgREST／LINEの実サービス一周を代替するものではない。

## 手動検証（スクリーンショット不要）

SQL・Auth設定・ClaudeのUIを接続した後に実施する。

1. PCの `ep10-preview.html?server=1` で許可メールを入力し、届いたリンクを同じブラウザで開く。`GET /api/session` が200、userIdが得られること。
2. そのままLINE連携を選び、返されたLIFF URLをLINEで開く。本人確認・連携確認を経て、PCと同じuserIdになること。初めてのLINEログインを先に独立実行しない。
3. 3問で○・×・まだ分からないをそれぞれ答える。answersが3行になり、同じPOSTを再送しても増えないこと。
4. 別ブラウザで新たにメールを要求・ログインし、同じ3回答と結果が復元すること。再挑戦後も旧attemptが残ること。
5. 認証済み画面で通信を切り、新しいattemptに回答。端末保存とpendingを確認し、再接続でsyncedとDB行数を確認すること。
6. 別の許可テスターでLINE先→メール連結も確認する。同じ既存テスターを逆順検証するためにデータを削除しない。既存の別IDへ連結する場合は409で双方の記録が変わらないこと。
7. 未許可メール・LINE、期限切れチケット、他人のattempt UUID／クライアントIDを送っても通らないこと。許可削除後はそのidentityの既存CookieもGET/POSTで拒否すること。

## 後続Sprint・保存期限

Stripeとentitlementsの書き込み、実データの有料カルテ、通知・配信は未実装。記録は「年内をめどに閲覧、消す前に案内」という設計メモのみで、閲覧期限・削除処理は今回追加しない。期限の具体値・削除案内の方法は今後決める。

参考： [Supabaseのメール認証](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[メールテンプレート](https://supabase.com/docs/guides/auth/auth-email-templates)、[secret key](https://supabase.com/docs/guides/getting-started/api-keys)、[LIFF追加パラメータ](https://developers.line.biz/ja/tips/2026/07/16/liff-url-additional-info/)。
