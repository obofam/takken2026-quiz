#!/bin/sh
# 公開漏れチェック（pre-pushフックから呼ばれる）
# サイトは「Gitにコミットされたファイルだけ」がVercelに公開される。
# 手元にあるのにコミットされていないファイル（=本番で404になるファイル）が
# 公開用フォルダにあったら、pushを止めて知らせる。
#
# 対象フォルダ: pdf/ audio/ img/ とリポジトリ直下のhtml
# 復旧手順はメッセージ内に表示される。

cd "$(git rev-parse --show-toplevel)" || exit 1

TARGETS="pdf audio img"

# 未追跡ファイル + gitignoreで無視されているファイル（どちらも本番に載らない）
untracked=$(git ls-files --others --exclude-standard $TARGETS ./*.html 2>/dev/null)
ignored=$(git ls-files --others --ignored --exclude-standard $TARGETS ./*.html 2>/dev/null)

problem=$(printf '%s\n%s\n' "$untracked" "$ignored" | grep -v '^$' | sort -u)

if [ -n "$problem" ]; then
  echo ""
  echo "🚫 push中止：本番で404になるファイルがあります"
  echo "（手元にはあるけどGitにコミットされていない＝Vercelに公開されないファイル）"
  echo ""
  echo "$problem" | sed 's/^/  - /'
  echo ""
  echo "▼ 公開したい場合（ほとんどの場合こっち）"
  echo "  git add <ファイル名> && git commit -m \"ファイル追加\" && git push"
  echo ""
  echo "▼ 公開しないファイルなら .gitignore に追加してから再push"
  echo ""
  exit 1
fi

exit 0
