# 耳で覚える宅建2026 ─ Webクイズ

パスワードゲート付きの宅建業法○×クイズサイト。スマホ版PDF教材の購入者限定。

## ファイル構成

- `index.html` ─ クイズ本体（これ1ファイルだけで動く）
- `README.md` ─ このファイル

## 本番公開の手順（GitHub Pages）

1. GitHubで新しいリポジトリを作成（例：`takken2026-quiz`、Public推奨）
2. このフォルダでターミナルを開き、以下を実行：

```
git init
git add index.html README.md
git commit -m "Initial commit: 宅建業法○×クイズ"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/takken2026-quiz.git
git push -u origin main
```

3. GitHubのリポジトリ画面で **Settings → Pages** を開く
4. **Source** を "Deploy from a branch"、**Branch** を `main` / `/ (root)` に設定して Save
5. 数分後に `https://<ユーザー名>.github.io/takken2026-quiz/` で公開される

## パスワード変更

`index.html` の先頭付近にある以下を書き換える：

```
const PASSWORD = "takken2026";
```

パスワードはクライアント側のJavaScriptに書かれているため、暗号学的に強固ではない（ソースを見れば誰でもわかる）。
購入者限定の「合言葉」として、カジュアルな共有を防ぐ程度の役割と考えてください。

## PDF内URLの更新

スマホ版PDFのP31（奥付）に記載のURLを、実際のGitHub PagesのURLに差し替える必要あり。
差し替え後にPDFを再生成してください（Claudeに依頼すればOK）。

## ライセンス

個人学習用。再配布・転載禁止。
