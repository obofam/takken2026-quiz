# LIFF本人テスト・Sprint 1

## 2026-09-17 の状態

共通ログインAPI、単回の連携チケット、回答の1行保存・復元、端末内再送キューを実装。9/17レビューA-1〜A-11を修正。A-11でSupabase既定メールテンプレートのaccess_tokenコールバックに対応した。今回の作業ではデプロイ・実メール送信・画面変更を行っていない。

**A-11の実装・自動テスト後、KeiかClaudeが配信と実機確認を判断する。** レビューE節のClaude報告を反映した状態は以下。

- Supabaseのmigration・allowlistはClaudeが適用済みと報告。下記SQLを再実行しない。
- Claudeがメール／LINEログイン・連携・同期状態の枠、正式文言、`privacy.html` の案内を追加済み。
- Site URL・Redirect URLs・Vercelの `LINE_CHANNEL_ID` もClaudeが設定済みと報告。
- メールテンプレートは既定のまま利用する。カスタムSMTPはSprint 2以降にKeiが判断。実メール・LINE・別ブラウザでの一周は未確認。

同期とログイン枠は検証用の `/ep10-preview.html?server=1` で有効。通常URL／localhostの従来端末内試作は維持。

## 作業チェック

- [x] 共通Cookie、LINE公式検証、メールトークンのサーバー検証、許可リスト
- [x] 許可された本人間のメール→LINE／LINE→メール連結API
- [x] 回答POST、所有者ごとのGET、重複保存防止、オフライン再送
- [x] ローカルDBで移行・権限・連携・保存の回帰検証
- [x] テストSupabaseへSQL適用・Auth設定（レビューE節のClaude報告）
- [x] Claudeのログイン／連携／保存状態UI・privacy案内
- [x] 既定メールテンプレートのaccess_token着地への対応
- [ ] 実メール・LINE・別ブラウザでの手動確認
- [ ] 上記完了後、KeiまたはClaudeがデプロイ判断

## セットアップ（テスト環境のみ）

環境変数は `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET`（32バイト以上）, `LINE_CHANNEL_ID`（既存値 `2011606963`）。新しい `sb_secret_` キーを使用し、旧 service_role JWT は使わない。`VERCEL_URL` / `VERCEL_BRANCH_URL` はプレビューのOrigin検証にVercel自動設定値を使う。秘密値はログ・チャット・gitに出さない。

以下は新規環境用。現在のテストプロジェクトは1〜3適用済みとの報告があるため、再実行しない。

1. Supabase SQL Editorで `supabase/migrations/202609170001_sprint1.sql` を適用する。新規7テーブルと2RPCを作成する一回限りの移行。既存スキーマを削除／置換しない。
2. 続いて `supabase/allowlist.local.sql` を適用する。今回指定されたメールと既存のKei本人LINEハッシュを登録済みのローカル専用ファイル。gitとVercel配信から除外している。未登録者のメール送信・ログイン・保存は拒否する。
3. Supabase AuthのRedirect URLsに `https://mimiobo-liff-test.vercel.app/auth-callback.html` を追加する。ローカル検証時のみ `http://127.0.0.1:3000/auth-callback.html` も追加。プレビューURLを使う場合はその正確なコールバックURLを登録する。
4. Magic LinkとConfirm signupは既定の `{{ .ConfirmationURL }}` を利用する。`api/email.js` はOTP要求の `redirect_to` に、要求元の許可済みorigin＋`/auth-callback.html` を明示する。ホスト環境では `https://mimiobo-liff-test.vercel.app/auth-callback.html`、ローカルではそのローカルorigin。Site URLには依存しない。着地のaccess_tokenをサーバー検証し、refresh_tokenは利用・保存せず破棄する。既存のtoken_hash経路も維持。テンプレート編集やSMTP追加は今回不要。
5. メールは要求したブラウザで10分以内に開く。要求時のhttpOnly Cookieと検証済みメールの一致を確認するため、別ブラウザでは拒否する。別端末でログインするときは、その端末で改めてメールを要求する。LINEアプリからメールを連結する場合も、LINEログイン済みの同じブラウザでリンクを開く必要がある。失敗時の案内はClaudeのUIで実装する。

Supabase secret keyはData API用で、今回の環境にはSQL適用用DB接続情報／管理API接続がない。ログイン済み管理画面での適用・Auth設定はプロジェクト分担どおり **Claudeで**。

## 実装の構成

- `lib/server.js`: Supabase REST、HMAC-SHA256セッション、Origin/JSON検査、許可リスト再確認。Originがない場合のみ同一オリジンのSec-Fetch-Site／Refererを代替とする。明示された異Origin・null・矛盾は拒否。CookieはHttpOnly / SameSite=Lax / HTTPSでSecure、7日。想定外例外は固定イベントと安全な例外型だけログに残し、トークン・上流の生エラーは出さない。Cookieは署名済みで暗号化ではない。
- `api/session.js`: LINEのID tokenを公式verify endpointで検証、aud/iss/expを照合。利用者UUIDに対応するCookieを発行。GETで復元、DELETEで当ブラウザをログアウト。
- `api/email.js`, `api/email-verify.js`: 許可メールにOTPリンクを要求。`{tokenHash}` はサーバーで交換し、`{accessToken}` はそのまま `GET /auth/v1/user`（`auth.getUser`相当）で検証する。両方同時の指定は拒否。どちらも要求時Cookie・確認済みメール・許可リストの検証を共用し、同じ利用者セッションCookieを発行する。APIからSupabaseトークンを返さない。
- `auth-callback.js`: fragment全体を通信前に消し、token_hashかaccess_tokenの一方だけをPOSTする。refresh_tokenは送信も保存もしない。localStorage／sessionStorageへSupabaseトークンを残さず、成功・失敗とも資格情報を含まないURLへ移動する。
- `api/link.js`: ログイン中の本人に、10分有効のLINE連携チケットを発行。DBにはSHA256だけを保存。消費・identity追加は単一トランザクション。既に別利用者IDのidentityは409として拒否し、自動統合しない。**初回から連結操作で第2の入口を通ること**。両方で独立ログイン済みの場合の統合は別途検討。
- `api/answers.js`: 本人IDはCookieから取得。POSTは `X-Mimiobo-User` がCookieのIDと一致しなければ拒否し、別タブのアカウント切替による混入を防ぐ。同一attempt/questionは最初のサーバー回答を採用。GETは所有者で絞り500件ずつ取得、1000attempt超は黙って切らずエラー。
- `supabase/`: 全テーブルRLSとブラウザロールの権限剥奪。secret keyが対応するサーバーロールだけが利用。空のentitlements以外のStripe処理はない。
- `sync.js`: 本人IDごとのキュー、回答ごとのPOST、読込時GET、競合時サーバー優先。送信前に復元し、POSTバッチ後にGETを1回行う。新たに答えた行だけ送る。旧ローカル履歴を本人の確認なく取り込まない。再挑戦の未回答attemptは端末内だけで保持し、最初の回答時にサーバーへ作る。400/409等の永久失敗行は本人別dead-letterへ隔離して自動再送しない。履歴GETの409も未送信行を隔離する。503／通信断は再試行、401/403は停止。

自動refresh（focus／online／storage）は2.5秒のデバウンス。初期取得済みセッションは `refresh({sessionVerified:true})` へ渡し、GET sessionを重複させない。端末保存とenqueueは別々に扱う。キュー書込失敗でも端末保存済みの回答を「未保存」に戻さず、再試行ボタンで現在のattemptをキューへ登録し直せる。書込失敗中は次回答・再挑戦を止めて取り残しを防ぎ、登録できたら再開する。二重のメモリキューはない。dead-letterは `mimiobo-answer-dead-letter-v1:<userId>:` 以下に回答とHTTP statusを保存し、原因を確認するまで保持する（削除・再投入UIはB以降）。entitlementsの内部plan値は `ume` / `take` / `matsu`。

SDK依存を増やさずNode標準fetchでRESTを呼ぶ構成にした。PGliteは開発テスト専用で本番APIからimportしない。`PROGRESS_STORE` / `KARTE_SUMMARY`の保護区間は変更していない。

端末内キャッシュキーは共通UUID由来に変更。旧LINEハッシュの保存領域は削除せず、未確認の過去回答を自動移行しない。通信が途切れた認証済みの開いている画面では回答を端末に保持し、再接続／フォーカスで再送する。オフラインで新規ロードした場合は本人確認できないのでサーバーモードの回答を有効にしない。

## Claudeの画面への接続契約

`auth-client.js` に文言なしの `window.MimioboAuth` を用意。

- `await MimioboAuth.email(address)`：ログインメールを要求。
- `await MimioboAuth.email(address, {link:true})`：現在の利用者にメールを結ぶ。認証済みCookie必須。
- `await MimioboAuth.linkLine()`：連携用LIFF URLを返す。本人が連携を選んだ後にだけ開く。リンク先ではLINE本人確認ボタンの操作が必要。**誰の記録にLINEを結ぶかの確認・同意UIをClaudeが仕上げてから公開する**。リンクの転送・共有はさせない。
- `await MimioboAuth.line(liff.getIDToken())`：LINE本人検証とチケット消費。既存ページから接続済み。
- `await MimioboAuth.logout()`：当ブラウザのCookieを削除。UI側で記録表示も閉じる。他の端末やコピーされた有効Cookieの強制失効は対象外。
- `mimiobo:sync` CustomEventの `event.detail.state` / `html[data-sync-state]`：`syncing` / `pending` / `synced` / `unauthorized` / `failed`。初期接続不能は `unavailable`。failedは永久失敗や隔離済み行がある状態なので、単純な再試行案内にしない。端末保存とサーバーへの到達を区別する。
- コールバックの `?auth=failed|unavailable|invalid_token` は初期化時に読み取り、`ui-messages.js` の `auth:*` 項目を表示する。APIエラーも同じ `MimioboMessages.text(code)` だけを通し、未知コード／例外の生文言は表示しない。Claudeが確定した文言はこのファイルのmessagesに集約済み。今回その文言・画面は変更していない。

LIFFは既存ID `2011606963-hH0DzETc`、エンドポイント `https://mimiobo-liff-test.vercel.app/` を維持。サーバーモード／liff.state付きの初期化は `liff.init()` → `captureLink()` → セッション・連携の判定の順。同一実行内でURLが変わってもserver=1を再評価する。旧appはSDK後にreadyへ進み、ep10にパスが変わった場合は対象ページを読み直す。チケットを保持したまま無言でreturnしない。実LINEでのリダイレクト・連携は未検証。

## ローカル起動と自動検証

このフォルダで通常は `npm ci` → `npm test`、API付き起動は `npm run dev`。ローカルハーネスは127.0.0.1:3000のみで待ち受け、配信するファイルを列挙し `.env` やSQLは配信しない。

今回のPCはnpmラッパーが存在しないRoaming配下のnpmを参照したため、インストール済み本体を直接使用した（npm自体のシステム設定は変えていない）：

```powershell
Set-Location 'C:\Claude\宅建\7_クイズと進捗トラッカー\liff-test'
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' test
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run dev
```

テストは既存13件の意図を維持（GET sessionは新仕様に更新）し、署名改ざん・期限・Origin・許可撤回・メール照合・所有者・同期・DB権限を追加。DBテストはメモリ内Postgres(PGlite)にSupabase相当ロールを作り、実際の移行とSQL回帰を実行する。Supabase Auth／PostgREST／LINEの実サービス一周を代替するものではない。

2026-09-17 A-1〜A-10修正後：`npm test`（上記npm本体経由）**61件すべて通過**。LIFFの同一実行内URL変更、旧indexのready、認証失敗表示、enqueue失敗からの再試行・操作停止も実際のクライアントJSをVMで評価して確認した。HTML/CSSと保護区間の不変確認も実施。

2026-09-17 A-11対応後：回帰テスト9件を追加し、**70件すべて通過**。access_tokenの200／不正401、メール・要求Cookieの照合、連携チケット保持、明示redirect_to、通信前のfragment削除、refresh_token非使用、ブラウザ保存なしを検証。実メール送信は行っていない。

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
