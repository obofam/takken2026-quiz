# -*- coding: utf-8 -*-
"""Umami 週次データ取得（Share URL方式・APIキー不要）
使い方:  python umami_fetch.py [日数]   # 省略時=7日
月曜レビューで実行 → 出力を umami_週次ログ.md / umami_watch.html に転記する。
"""
import json, sys, time, urllib.request

SLUG = "AnWP6Ox8wWRpOqY1"  # Share URL の末尾（Umami>Websites>Share URLで再発行可）
WID = "99a5370c-5fbd-4ceb-9d35-7734d7c580ec"
GW = "https://gateway-us.umami.is/api"

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

def get(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    return json.load(urllib.request.urlopen(req))

def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    token = get(f"https://cloud.umami.is/analytics/us/api/share/{SLUG}")["token"]
    h = {"x-umami-share-token": token, "x-umami-share-context": SLUG}
    end = int(time.time() * 1000)
    start = end - days * 86400000
    q = f"startAt={start}&endAt={end}"

    stats = get(f"{GW}/websites/{WID}/stats?{q}", h)
    print(f"== 直近{days}日 ==")
    c = stats.get("comparison", {})
    for k in ("visitors", "visits", "pageviews"):
        print(f"{k}: {stats[k]} (前期 {c.get(k, '-')})")

    for label, typ, limit in [("ホスト別", "hostname", 10), ("ページ別", "path", 15),
                               ("イベント", "event", 60), ("リファラ", "referrer", 10),
                               ("UTM source", "query", 15)]:
        try:
            rows = get(f"{GW}/websites/{WID}/metrics?{q}&type={typ}&limit={limit}", h)
            if typ == "query":
                rows = [r for r in rows if "utm_source" in r["x"]]
            print(f"\n== {label} ==")
            for r in rows:
                print(f"{r['x']}: {r['y']}")
        except Exception as e:
            print(f"\n== {label} == 取得失敗: {e}")

if __name__ == "__main__":
    main()
