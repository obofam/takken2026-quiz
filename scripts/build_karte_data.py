# -*- coding: utf-8 -*-
"""
模試カルテサイト（karte.html）用のデータビルドスクリプト。

模試カルテの正本データ（R5.json / R6.json / R7.json）から、著作権保護のため
問題文(stem)と選択肢本文(text)を除いた最小限のフィールドだけを抜き出し、
karte_data.js（window.KARTE_DATA = {...}）として書き出す。

使い方:
    cd 7_クイズと進捗トラッカー
    python scripts/build_karte_data.py
    python scripts/build_karte_data.py --allow-stub   # R6.jsonが無い場合に_stub_R6.jsonで代用（テスト用の逃げ道）

出力:
    karte_data.js
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

# このスクリプトは 7_クイズと進捗トラッカー/scripts/ に置く前提
SITE_DIR = Path(__file__).resolve().parent.parent
KARTE_SRC_DIR = Path(r"C:\Claude\宅建\6_有料PDF\最後まで伴走_商品設計\模試カルテ")
DATA_DIR = KARTE_SRC_DIR / "data"
OUT_JS = SITE_DIR / "karte_data.js"

# 年度キー -> (表示名, ファイル名)
# R6=模試①（令和6年度）、R7=模試②（令和7年度）、R5=令和5年度（本試験相当・模試ラベルなし）
YEAR_META = {
    "R5": {"label": "令和5年度", "file": "R5.json"},
    "R6": {"label": "令和6年度（模試①）", "file": "R6.json"},
    "R7": {"label": "令和7年度（模試②）", "file": "R7.json"},
}

# 問題文・選択肢本文は含めない（著作物の全文をWebに載せないため）
QUESTION_FIELDS = [
    "no", "field", "law", "topic", "form", "answer",
    "hard_type", "difficulty", "ep", "study_hint", "note",
]
CHOICE_FIELDS = ["n", "correct", "why", "trap"]


def strip_question(q: dict) -> dict:
    out = {k: q.get(k) for k in QUESTION_FIELDS}
    out["choices"] = [{k: c.get(k) for k in CHOICE_FIELDS} for c in q.get("choices", [])]
    return out


def load_year(key: str, meta: dict, allow_stub: bool) -> dict | None:
    path = DATA_DIR / meta["file"]
    used_stub = False
    if not path.exists():
        if allow_stub and key == "R6":
            stub_path = DATA_DIR / "_stub_R6.json"
            if stub_path.exists():
                path = stub_path
                used_stub = True
            else:
                return None
        else:
            return None

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    questions = [strip_question(q) for q in data.get("questions", [])]
    result = {
        "label": meta["label"],
        "year": data.get("year", meta["label"]),
        "exam": data.get("exam", key),
        "questions": questions,
    }
    if used_stub:
        result["_stub"] = True
    return result


def load_episodes() -> list[dict]:
    path = DATA_DIR / "episodes.csv"
    episodes = []
    if not path.exists():
        print(f"警告: episodesファイルが見つかりません: {path}", file=sys.stderr)
        return episodes
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                ep = int(row["ep"])
            except (KeyError, ValueError, TypeError):
                continue
            episodes.append({
                "ep": ep,
                "date": row.get("date", ""),
                "field": row.get("field", ""),
                "title": row.get("title", ""),
                "law": row.get("law", ""),
            })
    return episodes


def main() -> None:
    parser = argparse.ArgumentParser(description="karte.html用のkarte_data.jsを生成する")
    parser.add_argument(
        "--allow-stub", action="store_true",
        help="R6.jsonが無い場合に_stub_R6.jsonをR6として取り込む（テスト用の逃げ道）",
    )
    args = parser.parse_args()

    years: dict[str, dict] = {}
    for key, meta in YEAR_META.items():
        y = load_year(key, meta, args.allow_stub)
        if y:
            years[key] = y
            stub_note = "（スタブ）" if y.get("_stub") else ""
            print(f"読み込み: {key}{stub_note} - {len(y['questions'])}問")
        else:
            print(f"スキップ: {key}（{meta['file']} が見つかりません）")

    if not years:
        sys.exit("エラー: 有効な年度データが1つもありません。R5.json/R6.json/R7.jsonを用意するか、--allow-stubを付けてください。")

    episodes = load_episodes()

    payload = {
        "years": years,
        "episodes": episodes,
    }

    js_text = "// 自動生成: scripts/build_karte_data.py で再生成できます。手で編集しないこと。\n"
    js_text += "window.KARTE_DATA = " + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n"

    OUT_JS.write_text(js_text, encoding="utf-8", newline="\n")
    print(f"生成: {OUT_JS}")


if __name__ == "__main__":
    main()
