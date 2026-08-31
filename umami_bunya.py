# -*- coding: utf-8 -*-
"""問題集の中の動き（分野別・カード別）を読む（Share URL方式・APIキー不要）

使い方: python umami_bunya.py [日数]   # 省略時=30日

2026-08-31 に index.html へ仕込んだイベントを読む。
Umami の share API は「イベント×1プロパティ」の値分布しか引けないため、
クロス集計は値を連結して持たせてある（gr="kenri|不正解" / mr / sm）。
"""
import json
import sys
import time
import urllib.parse
import urllib.request

SLUG = "AnWP6Ox8wWRpOqY1"
WID = "99a5370c-5fbd-4ceb-9d35-7734d7c580ec"
GW = "https://gateway-us.umami.is/api"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

JP = {
    "gyouhou": "宅建業法", "kenri": "権利関係", "houreizei": "法令上の制限・税",
    "chokuzen": "直前対策", "other": "その他", "none": "（全問正解）",
    "sample": "おためし", "section": "科目別", "knock": "千本ノック",
    "__knock": "千本ノック",
    "full": "全問チャレンジ", "random": "ランダム10問",
    "mistakes": "間違えた問題だけ", "review": "全問レビュー",
}


def jp(k):
    return JP.get(k, k)


def get(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    token = get(f"https://cloud.umami.is/analytics/us/api/share/{SLUG}")["token"]
    h = {"x-umami-share-token": token, "x-umami-share-context": SLUG}
    end = int(time.time() * 1000)
    base = {"startAt": end - days * 86400000, "endAt": end}

    def values(event, prop):
        p = {**base, "event": event, "propertyName": prop}
        try:
            rows = get(f"{GW}/websites/{WID}/event-data/values?" + urllib.parse.urlencode(p), h)
            return {r["value"]: r["total"] for r in rows}
        except Exception as e:
            print(f"  （{event}/{prop} 取得失敗: {e}）")
            return {}

    print(f"=== 問題集の中の動き・直近{days}日 ===")

    # ── 1. 分野別の正答率（gr = "分野|正誤"）──────────────────────
    gr = values("quiz_answer", "gr")
    if not gr:
        print("\n【分野別】まだデータなし。"
              "\n  2026-08-31 に計測を仕込んだので、デプロイ後に解かれた分から溜まる。")
    else:
        agg = {}
        for k, n in gr.items():
            genre, _, result = k.partition("|")
            a = agg.setdefault(genre, {"正解": 0, "不正解": 0})
            a[result] = a.get(result, 0) + n
        print("\n【分野別の正答率】※低いほど苦戦している＝伸びしろ")
        print(f"  {'分野':<18}{'正答率':>7}{'正解':>7}{'不正解':>7}{'計':>7}")
        rows = []
        for genre, a in agg.items():
            tot = a["正解"] + a["不正解"]
            rows.append((a["正解"] / tot if tot else 0, genre, a, tot))
        for pct, genre, a, tot in sorted(rows):
            print(f"  {jp(genre):<18}{round(pct*100):>6}%{a['正解']:>7}{a['不正解']:>7}{tot:>7}")

    # ── 2. モード別の正答率（mr = "モード|正誤"）─────────────────
    mr = values("quiz_answer", "mr")
    if mr:
        agg = {}
        for k, n in mr.items():
            mode, _, result = k.partition("|")
            a = agg.setdefault(mode, {"正解": 0, "不正解": 0})
            a[result] = a.get(result, 0) + n
        print("\n【解き方別の正答率】")
        for mode, a in sorted(agg.items(), key=lambda kv: -(kv[1]["正解"] + kv[1]["不正解"])):
            tot = a["正解"] + a["不正解"]
            print(f"  {jp(mode):<18}{round(a['正解']/tot*100) if tot else 0:>6}%  ({tot}回答)")

    # ── 3. どのカードが開かれたか ──────────────────────────────
    opened = values("section_open", "section")
    prompted = values("lock_prompt", "section")
    unlocked = values("section_unlock", "section")
    failed = values("unlock_fail", "section")
    if opened or prompted:
        print("\n【カード別・開かれ方】")
        print(f"  {'カード':<14}{'開封':>6}{'ロック突破試行':>14}{'解除成功':>10}{'PW失敗':>8}")
        for key in sorted(set(opened) | set(prompted) | set(unlocked) | set(failed),
                          key=lambda k: -(opened.get(k, 0) + prompted.get(k, 0))):
            print(f"  {jp(key):<14}{opened.get(key,0):>6}{prompted.get(key,0):>14}"
                  f"{unlocked.get(key,0):>10}{failed.get(key,0):>8}")
        print("  ※ロック突破試行＞解除成功 の差＝「欲しがったが入れなかった人」＝教材の需要")

    # ── 4. 科目×解き方 ─────────────────────────────────────────
    sm = values("quiz_start", "sm")
    if sm:
        print("\n【科目×解き方】どう解かれているか")
        for k, n in sorted(sm.items(), key=lambda kv: -kv[1]):
            sec, _, mode = k.partition("|")
            print(f"  {jp(sec)} / {jp(mode)}: {n}")

    # ── 5. おためしの弱点分野 ──────────────────────────────────
    weak = values("sample_complete", "weak")
    pct = values("sample_complete", "pct")
    if weak:
        print("\n【おためし5問で最も落とした分野】")
        tot = sum(weak.values())
        for k, n in sorted(weak.items(), key=lambda kv: -kv[1]):
            print(f"  {jp(k)}: {n}件 ({round(n/tot*100)}%)")
    if pct:
        print("\n【おためしの得点分布】")
        tot = sum(pct.values())
        for k, n in sorted(pct.items(), key=lambda kv: -int(kv[0])):
            print(f"  {k}点: {n}件 ({round(n/tot*100)}%)")
        hi = sum(n for k, n in pct.items() if int(k) >= 80)
        print(f"  → 80点以上が {round(hi/tot*100)}%。"
              f"{'やさしすぎて実力が測れていない疑い' if hi/tot > 0.7 else '難易度は妥当な範囲'}")

    # ── 6. 現在地診断（自己申告の苦手分野）─────────────────────
    print("\n【現在地診断・分野別の苦手申告】※自己申告")
    for prop, label in [("q3_kenri", "権利関係"), ("q3_hourei", "法令上の制限"),
                        ("q3_gyoho", "宅建業法"), ("q3_zei", "税・その他")]:
        v = values("shindan_complete", prop)
        if not v:
            continue
        ari, nashi = v.get("あり", 0), v.get("なし", 0)
        tot = ari + nashi
        print(f"  {label:<12} 苦手あり {ari:>3} / なし {nashi:>3}"
              f"  → {round(ari/tot*100) if tot else 0}%が苦手")
    t = values("shindan_complete", "type")
    if t:
        print("  タイプ分布: " + " / ".join(f"{k} {n}" for k, n in sorted(t.items(), key=lambda kv: -kv[1])))


if __name__ == "__main__":
    main()
