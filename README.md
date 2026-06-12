# 耳で覚える宅建2026 スマホで解ける〇×問題集 — 運用メモ

**このフォルダが唯一の編集元**（2026-06-08 一本化。旧 `5_有料PDF/quiz_site` は `99_archive/quiz_site_旧編集元_20260608/` に退避済み）

## 本番URL
- クイズ：https://takken2026-quiz.vercel.app/
- トラッカー：https://takken2026-quiz.vercel.app/tracker.html

## ファイル構成（⚠ここを間違えやすい）
| ファイル | 役割 | URL |
|---|---|---|
| `index.html` | **クイズ本体**（〇×問題集。Vercelの仕様でこの名前のまま＝サイトのトップページ） | https://takken2026-quiz.vercel.app/ |
| `tracker.html` | **進捗トラッカー**（学習進捗の見える化） | https://takken2026-quiz.vercel.app/tracker.html |
- `SITE_GUIDE.md` … 設計思想・パスワード一覧・デザイン仕様（詳細はこちら）
- `README.md` … このファイル

## デプロイ手順（これ一本）
```
cd C:\Claude\宅建\7_クイズと進捗トラッカー
vercel --prod
```
デプロイ後、履歴記録用にgitコミット（⚠PowerShellは `&&` 非対応なので1行ずつ実行）：
```
git add -A
git commit -m "変更内容のメモ"
```
git push は GitHub バックアップ用（Vercel自動デプロイの有無に関わらず、フォルダが1つなので巻き戻り事故は起きない）。

## やってはいけないこと
- このフォルダ以外に index.html のコピーを作って編集しない（2026-05-31 の巻き戻り未遂の原因）
