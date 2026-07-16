# 耳で覚える宅建2026 スマホで解ける〇×問題集 — 運用メモ

**このフォルダが唯一の編集元**（2026-06-08 一本化。旧 `5_有料PDF/quiz_site` は `99_archive/quiz_site_旧編集元_20260608/` に退避済み）

## 本番URL（⚠2つある。両方とも本番。2026-06-13確定）

| 利用者 | 本番URL | リンクの在りか | 更新コマンド |
|---|---|---|---|
| 〇×問題集の購入者 | https://takken2026-quiz.vercel.app/ | 販売ページ4本＋**有料PDF誌面に印字済み（変更不可）** | `vercel --prod` |
| トラッカー利用者 | https://obofam.github.io/takken2026-quiz/tracker.html | LINEリッチメニュー | `git push` |

**一本化はしない（確定）**：トラッカーの学習履歴はlocalStorage＝ドメイン単位で保存されるため、URLを替えると既存ユーザーの進捗が消える。ユーザーに移行コストを押し付けない。

## ファイル構成（⚠ここを間違えやすい）
| ファイル | 役割 | URL |
|---|---|---|
| `index.html` | **クイズ本体**（〇×問題集。Vercelの仕様でこの名前のまま＝サイトのトップページ） | https://takken2026-quiz.vercel.app/ |
| `tracker.html` | **進捗トラッカー**（学習進捗の見える化） | https://takken2026-quiz.vercel.app/tracker.html |
- `SITE_GUIDE.md` … 設計思想・パスワード一覧・デザイン仕様（詳細はこちら）
- `README.md` … このファイル

## デプロイ手順（ツールごとにリリースボタンが違う・2026-06-13 Kei決定）

**トラッカー（tracker.html）を更新したとき** → git push が本番反映：
```
cd C:\Claude\宅建\7_クイズと進捗トラッカー
git add -A
git commit -m "変更内容のメモ"
git push
```

**クイズ本体（index.html）を更新したとき** → vercel --prod が本番反映：
```
cd C:\Claude\宅建\7_クイズと進捗トラッカー
vercel --prod
```
＋履歴記録のため上のgit 3行もやる（バックアップが本番から遅れないように）。

**動作確認は必ず利用者が見るほうのURLで**：トラッカー=github.io／問題集=vercel.app。逆を見ると「直ってない！」と誤認する（2026-06-13に発生）。
デプロイ後、履歴記録用にgitコミット（⚠PowerShellは `&&` 非対応なので1行ずつ実行）：
```
git add -A
git commit -m "変更内容のメモ"
```
git push は GitHub バックアップ用（Vercel自動デプロイの有無に関わらず、フォルダが1つなので巻き戻り事故は起きない）。

## やってはいけないこと
- このフォルダ以外に index.html のコピーを作って編集しない（2026-05-31 の巻き戻り未遂の原因）
