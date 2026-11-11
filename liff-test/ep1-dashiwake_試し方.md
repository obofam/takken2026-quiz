# 第1回「図解と3問」出し分け試作の試し方

## 確かめること
同じページを、LINEに登録している人と、していない人で見え方を変えられるか。
- 登録していない人・LINEの外：公開版と同じ（図解1枚、○×3問、続きはLINEの案内、「LINEで開く」ボタン）
- LINEの中で開き、友だちと確かめられた人：図解6枚と「今日のポイント」、過去問1選を表示。案内枠は消える
- 全部版の中身は `ep1-full.html` と `ep1-full.js` にあり、友だちと確かめられたあとで読み込む（未登録の人のページには入らない）

## 開き方3通り
1. ふつうにブラウザで開く：Aの表示
2. URLの末尾に `?mihon=touroku`：Bの見た目の確認（判定なし）。`?mihon=mitouroku` はAの表示
3. LINEの中で開く：本物の判定。LINEのトーク画面に次のURLを送って、スマホのLINEでタップする

```
https://liff.line.me/2011606963-hH0DzETc/ep1-dashiwake.html
```

前提：`liff-test` を `mimiobo-liff-test.vercel.app` にデプロイ済みであること（LIFFのエンドポイントがそこ）。

## 画面の下の「状態」の行
- 状態：LINEの外 ＝ ログインしていない（Aのまま）
- 状態：LINEの中・友だち ＝ Bの表示
- 状態：LINEの中・友だちではない ＝ 公式アカウントを友だち追加していない（Aのまま）
- 状態：確認できなかった（理由） ＝ SDK・`liff.init`・`getFriendship` のどこかで失敗（Aのまま）。同じ内容がコンソールの `console.warn` にも出る
  - 「友だち追加の設定が済んでいない」系の理由が出たら、下の LINE Developers の設定を確認

## 本番の `ep\N\` に入れるときに要ること
- ページは `takken.mimiobo.com` にあり、LIFFのエンドポイントは `mimiobo-liff-test.vercel.app` なので、LIFFのページとして開けるのはエンドポイント側のドメインのページだけ。方法は2つ（要判断）
  1. 全回ぶんの出し分けページを `liff-test` 側に置く（このやり方。画像はtakken側のURLを参照）
  2. LIFFアプリを新しく作り、エンドポイントを takken.mimiobo.com にする（LIFF IDが変わる）
- 回ごとの全部版は `epN-full.html`／`epN-full.js` を回の数だけ作る（中身の元は build.py のデータ）。ページ側の出し分けコードは共通化できる
- LINE Developers 側（推測。管理画面は未確認）：LINEログインのチャネルに公式アカウントを結びつける（bot link。友だち追加オプションを「On」）。`getFriendship()` に必要。スコープに `profile` が要る可能性
- Supabase への記録は今回なし。登録者の識別をサーバー側でもやるなら、ID トークンの検証（`api/session` の仕組み）に乗せる
- 判定は端末の表示の出し分けだけで、全部版のファイルは URL を知っていれば誰でも取れる（秘密にはならない）。続きを本当に限るなら、サーバー側でIDトークン検証したうえで返す形が要る

## 2026-11-11 追記：判定の変更
- LINEの中でログイン済みなら、登録者として全部（B）を表示。getFriendship は参考（3秒で返らなければ失敗扱い）。
- getFriendship が成功して friendFlag が false のときだけ A に戻す。失敗・未確定は B のまま（状態は「LINEの中（友だちの確認はできなかった）」）。
- LINEの外でログイン済みは、従来どおり getFriendship の結果で決める（true のときだけB）。isLoggedIn が false・init 失敗は A。
- 変えた理由：getFriendship が実機で「There is no login bot linked to this channel.（400）」になり、LINE側の設定を直しても Bにならなかったため。
- A の「LINEで開く」ボタンと「LINEに登録している方は…」の説明文は削除（LINE内で開けば誰でも全部が見えてしまうため）。友だち追加のリンクは残す。

## 3段の試作（ep1-3dan.html）
通常・LINE登録者・やさしいテキスト購入者の3段。`ep1-dashiwake.html` は残してある。

- 1段目（通常）：図解1枚、○×3問、友だち追加の案内
- 2段目（LINE登録者）：図解ぜんぶ、今日のポイント、過去問1選。いちばん下に「やさしいテキスト」の見本1枚と「続きはこちら」（リンク先は仮で `plans-preview.html`）。枠は `&mihon_text=0` で消える
- 3段目（やさしいテキスト購入者）：前半のテキスト、前半の○×3問、後半のテキスト、後半の○×3問、今日のポイント、過去問1選（放送の順）。赤シートはテキストの大事な語・数字（前半12・後半12か所）

### 切替のURL（ブラウザで確認）
- `ep1-3dan.html?mihon=mitouroku`：1段目
- `ep1-3dan.html?mihon=touroku`：2段目（`&mihon_text=0` で見本の枠なし）
- `ep1-3dan.html?mihon=kounyu`：3段目。`/api/ep-text?ep=1&mihon=1` を呼ぶので、サーバーの環境変数 `ALLOW_TEXT_PREVIEW=1` が要る（なければ2段目のまま、状態の箱に401）

### 本物の判定
LINEの中で開く → 2段目 → IDトークンで `/api/session` にPOST → `/api/ep-text?ep=1`。200なら3段目、403・401・失敗なら2段目のまま。状態の箱の「text」に結果が出る。

```
https://liff.line.me/2011606963-hH0DzETc/ep1-3dan.html
```

### 購入者にする（テスト）
先にマイグレーション `supabase/migrations/202611110001_text_plan.sql` をテストSupabaseのSQL Editorで適用する。そのあと：

```
node scripts/db-grant.mjs <id先頭8文字> text
node scripts/db-grant.mjs <id先頭8文字> text --revoke
```

### テキストの作り方
元は `6_有料PDF\やさしいテキスト_2027\第01回_宅建業と免許.html`。`node scripts/build-ep1-text.mjs` で `api/_ep-text/ep1.js` を作る（タグを除いた文言が元と一致しなければ失敗する）。有料の中身は `api/_` 以下だけで、URLでは取れない。
