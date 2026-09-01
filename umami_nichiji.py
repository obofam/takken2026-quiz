# -*- coding: utf-8 -*-
"""日次・時間帯別を JST で正しく見る（配信やLINEの効果測定用）

使い方:
  python umami_nichiji.py            # 直近7日の日次
  python umami_nichiji.py 14         # 直近14日の日次
  python umami_nichiji.py 7 -H       # 日次＋昨日の3時間刻み
  python umami_nichiji.py 7 -H 2026-08-31   # 指定日の3時間刻み

【重要な落とし穴・2026-08-31に踏んだ】
Umamiの /pageviews は unit/timezone を渡しても、返ってくる x が **UTC**（末尾Z）。
timezone パラメータはバケットのラベルに反映されない。これをJSTと誤読すると
9時間ズレて「増えた」「減った」が逆に見える。
→ このスクリプトは /pageviews を使わず、**JSTの範囲を startAt/endAt に直接渡して
  /stats を1コマずつ引く**。遅いが曖昧さがゼロ。

数字はすべて country=JP（日本のみ）。海外botの水増しを除くため。
"""
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

SLUG = "AnWP6Ox8wWRpOqY1"
WID = "99a5370c-5fbd-4ceb-9d35-7734d7c580ec"
GW = "https://gateway-us.umami.is/api"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
JST = timezone(timedelta(hours=9))
WD = "月火水木金土日"

HOME_HOSTS = ["www.mimiobo.com", "mimiobo.vercel.app"]
QUIZ_HOST = "takken2026-quiz.vercel.app"
TRACKER_HOST = "obofam.github.io"


def get(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def main():
    args = [a for a in sys.argv[1:]]
    hourly = "-H" in args
    if hourly:
        args.remove("-H")
    days = int(args[0]) if args and args[0].isdigit() else 7
    target = next((a for a in args if "-" in a), None)

    token = get(f"https://cloud.umami.is/analytics/us/api/share/{SLUG}")["token"]
    h = {"x-umami-share-token": token, "x-umami-share-context": SLUG}
    now = datetime.now(JST)

    def visitors(a, b, extra=None):
        p = {"startAt": int(a.timestamp() * 1000), "endAt": int(b.timestamp() * 1000),
             "country": "JP", **(extra or {})}
        try:
            return get(f"{GW}/websites/{WID}/stats?" + urllib.parse.urlencode(p), h)["visitors"]
        except Exception:
            return 0

    def row(a, b):
        total = visitors(a, b)
        hp = sum(visitors(a, b, {"hostname": x}) for x in HOME_HOSTS)
        tr = visitors(a, b, {"hostname": TRACKER_HOST})
        qz = visitors(a, b, {"hostname": QUIZ_HOST})
        return total, hp, tr, qz

    print(f"=== 日次・日本のみ（JST実測）{now:%Y-%m-%d %H:%M} 時点 ===")
    print(f"{'日付':<12}{'全体':>6}{'メインHP':>9}{'トラッカー':>10}{'クイズ':>8}")
    series = []
    for back in range(days - 1, -1, -1):
        d0 = (now - timedelta(days=back)).replace(hour=0, minute=0, second=0, microsecond=0)
        d1 = min(d0 + timedelta(days=1), now)
        total, hp, tr, qz = row(d0, d1)
        series.append((d0, total))
        tail = " ←途中" if d1 == now else ""
        print(f"{d0:%m/%d}({WD[d0.weekday()]}) {total:>5}{hp:>9}{tr:>10}{qz:>8}  {'█'*total}{tail}")

    done = [s for s in series if s[0].date() != now.date()]
    if len(done) >= 2:
        base = sum(v for _, v in done[:-1]) / max(1, len(done) - 1)
        last_d, last_v = done[-1]
        print(f"\n直近の完了日 {last_d:%m/%d}({WD[last_d.weekday()]}) = {last_v}人 / "
              f"それ以前の平均 {base:.1f}人 → {'+' if last_v >= base else ''}{round((last_v/base-1)*100) if base else 0}%")

    if hourly:
        if target:
            d0 = datetime.strptime(target, "%Y-%m-%d").replace(tzinfo=JST)
        else:
            d0 = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        print(f"\n=== {d0:%m/%d}({WD[d0.weekday()]}) の3時間刻み・日本のみ（JST）===")
        for k in range(8):
            a = d0 + timedelta(hours=3 * k)
            b = min(a + timedelta(hours=3), now)
            if a >= now:
                break
            total, hp, tr, qz = row(a, b)
            print(f"  {a:%H:%M}-{b:%H:%M}  全体{total:>3} HP{hp:>3} トラッカー{tr:>3} クイズ{qz:>3}  {'█'*total}")


if __name__ == "__main__":
    main()
