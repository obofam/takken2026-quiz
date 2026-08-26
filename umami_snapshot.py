# -*- coding: utf-8 -*-
"""Umami Artifact用 週次スナップショット生成（Share URL方式・APIキー不要）
umami_fetch.py と同じAPIレシピで直近N日＋前期間（APIのcomparisonを利用）のデータを取得し、
数字を焼き込んだ完全静的HTML（JSなし・外部リソースなし）を出力する。

使い方: python umami_snapshot.py [日数]   # 省略時=7日
出力先は OUT_PATH 定数（Artifact化する際の下書き置き場）。
"""
import html
import json
import sys
import time
import urllib.parse
import urllib.request

SHARE_ID = "AnWP6Ox8wWRpOqY1"  # Share URL の末尾（Umami>Websites>Share URLで再発行可）
WEBSITE_ID = "99a5370c-5fbd-4ceb-9d35-7734d7c580ec"
GW = "https://gateway-us.umami.is/api"
TOKEN_URL = f"https://cloud.umami.is/analytics/us/api/share/{SHARE_ID}"

OUT_PATH = (
    r"C:\Users\canne\AppData\Local\Temp\claude\C--Claude---"
    r"\3c089994-0cda-4c7b-ba63-0fe62f93f724\scratchpad\umami_snapshot.html"
)

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# 7ページ定義（umami_watch.html と同じ構造）
PAGE_DEFS = [
    {"key": "tracker", "name": "進捗トラッカー", "icon": "\U0001F4CA", "path": "/takken2026-quiz/tracker.html",
     "prefixes": ["tracker_", "progress_toggle", "revisit", "stand_fm", "note_summary"]},
    {"key": "kyozai", "name": "教材一覧", "icon": "\U0001F5C2", "path": "/kyozai.html",
     "prefixes": ["kyozai_"]},
    {"key": "weekly", "name": "週1過去問コーナー", "icon": "\U0001F4DD", "path": "/weekly.html",
     "prefixes": ["weekly_", "週1問_回答"]},
    {"key": "quiz", "name": "一問一答問題集", "icon": "\U0001F4DA", "path": "/",
     "prefixes": ["sample_", "buyguide_", "modal_", "knock_"]},
    {"key": "omikuji", "name": "おみくじ", "icon": "\U0001F3B2", "path": "/omikuji.html",
     "prefixes": ["omikuji_"]},
    {"key": "shindan", "name": "現在地診断", "icon": "\U0001F9ED", "path": "/shindan.html",
     "prefixes": ["shindan_"]},
    {"key": "home", "name": "メインHP", "icon": "\U0001F3E0", "hostname": "mimiobo.vercel.app",
     "prefixes": ["home_"]},
]


def get(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.load(res)


def api_get(path, params, headers):
    qs = urllib.parse.urlencode(params)
    return get(f"{GW}/websites/{WEBSITE_ID}{path}?{qs}", headers)


def matches_prefixes(name, prefixes):
    return any(name == p or name.startswith(p) for p in prefixes)


def top_events_for(prefixes, event_list, n=5):
    matched = [e for e in event_list if matches_prefixes(e["x"], prefixes)]
    matched.sort(key=lambda e: e["y"], reverse=True)
    return matched[:n]


def fmt_duration(sec):
    if not sec or sec <= 0:
        return "0m00s"
    m = int(sec // 60)
    s = round(sec % 60)
    return f"{m}m{s:02d}s"


def pct_of(part, total):
    return round(part / total * 100) if total else 0


def delta(now, prev):
    """(css_class, 表示テキスト) を返す。umami_watch.html の delta() とロジックを揃えてある。"""
    if prev is None:
        return ("flat", "新設")
    if prev == 0:
        return ("flat", f"\u25b2{now}（新規）") if now else ("flat", "\u2014")
    diff = now - prev
    if diff == 0:
        return ("flat", "\u00b10")
    p = round(diff / prev * 100)
    cls = "up" if diff > 0 else "down"
    sign = "\u25b2" if diff > 0 else "\u25bc"
    return (cls, f"{sign}{abs(diff)}（{'+' if p > 0 else ''}{p}%）")


def esc(x):
    return html.escape(str(x), quote=True)


def fetch_all(days):
    token = get(TOKEN_URL)["token"]
    headers = {"x-umami-share-token": token, "x-umami-share-context": SHARE_ID}

    end = int(time.time() * 1000)
    start = end - days * 86400000
    base_params = {"startAt": start, "endAt": end}

    overall = api_get("/stats", base_params, headers)
    events = api_get("/metrics", {**base_params, "type": "event", "limit": 100}, headers)
    hosts = api_get("/metrics", {**base_params, "type": "hostname", "limit": 10}, headers)
    queries = api_get("/metrics", {**base_params, "type": "query", "limit": 30}, headers)

    # UTM source 集計（utm_source を含む行だけ拾い、同じsource値は合算）
    utm_totals = {}
    for row in queries:
        qs = urllib.parse.parse_qs(row["x"])
        src = qs.get("utm_source", [None])[0]
        if src:
            utm_totals[src] = utm_totals.get(src, 0) + row["y"]
    utm_rows = sorted(utm_totals.items(), key=lambda kv: kv[1], reverse=True)

    pages = []
    for d in PAGE_DEFS:
        try:
            if "hostname" in d:
                params = {**base_params, "hostname": d["hostname"]}
            else:
                params = {**base_params, "path": d["path"]}
            stat = api_get("/stats", params, headers)
            comp = stat.get("comparison", {}) or {}
            pages.append({
                **d,
                "visitors": stat["visitors"], "views": stat["pageviews"],
                "prev_visitors": comp.get("visitors"), "prev_views": comp.get("pageviews"),
                "events": top_events_for(d["prefixes"], events, 5),
                "error": False,
            })
        except Exception as e:
            pages.append({**d, "error": True, "err": str(e)})

    return {
        "days": days, "start": start, "end": end,
        "overall": overall, "events": events, "hosts": hosts,
        "utm_rows": utm_rows, "pages": pages,
    }


CSS = """
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px 16px 60px; background: #f4f8f9; color: #2b3438;
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;
  line-height: 1.6;
}
.wrap { max-width: 1180px; margin: 0 auto; }
header { margin-bottom: 20px; }
header h1 { font-size: 21px; margin: 0 0 6px; }
header .meta { font-size: 13px; color: #6b7a80; }
.card {
  background: #ffffff; border-radius: 14px; padding: 18px 20px; margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid #e7eef0;
}
.card h2 { font-size: 15px; margin: 0 0 14px; color: #0e7c8b; display: flex; align-items: center; gap: 6px; }
.card h2 .sub { font-size: 12px; color: #9aa7ab; font-weight: 400; margin-left: auto; }
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.summary-item { background: #eefaf9; border-radius: 10px; padding: 14px; text-align: center; }
.summary-item .label { font-size: 12px; color: #5c6c70; margin-bottom: 6px; }
.summary-item .value { font-size: 22px; font-weight: 700; color: #0e7c8b; }
.summary-item .sub { font-size: 12px; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eef2f3; }
th { color: #6b7a80; font-weight: 500; font-size: 12px; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.page-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.pcard {
  border: 1px solid #e2ecee; border-radius: 12px; padding: 14px 14px 12px;
  background: #ffffff; display: flex; flex-direction: column;
}
.pcard .phead { display: flex; align-items: baseline; gap: 6px; margin-bottom: 2px; }
.pcard .pname { font-size: 14px; font-weight: 700; color: #2b3438; }
.pcard .ppath { font-size: 11px; color: #a6b2b6; margin-bottom: 10px; font-family: ui-monospace, Menlo, Consolas, monospace; }
.pcard .pnums { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.pcard .pnum { background: #f2fafa; border-radius: 8px; padding: 8px 6px; text-align: center; }
.pcard .pnum .n { font-size: 21px; font-weight: 700; color: #0e7c8b; line-height: 1.2; font-variant-numeric: tabular-nums; }
.pcard .pnum .t { font-size: 10.5px; color: #7c8b8f; }
.pcard .pnum .d { font-size: 11px; margin-top: 2px; font-variant-numeric: tabular-nums; }
.up { color: #128a5f; }
.down { color: #b4553f; }
.flat { color: #9aa7ab; }
.pcard .pev { font-size: 12.5px; color: #4c5b60; border-top: 1px dashed #e2ecee; padding-top: 8px; margin-top: auto; }
.pcard .pev div { display: flex; justify-content: space-between; gap: 8px; padding: 1.5px 0; }
.pcard .pev .k { color: #6b7a80; }
.pcard .pev .v { font-variant-numeric: tabular-nums; font-weight: 600; color: #2b3438; }
.rank { font-size: 11px; color: #ffffff; background: #17a2af; border-radius: 999px; padding: 1px 7px; font-weight: 700; }
.rank.g { background: #cbd6d8; color: #5c6c70; }
.fetch-fail { font-size: 13px; color: #b4553f; background: #fdf1ee; border-radius: 8px; padding: 10px 12px; }
footer { text-align: center; font-size: 12px; color: #9aa7ab; margin-top: 24px; }
@media (max-width: 1000px) { .page-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 900px) { .summary-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 620px) { .page-grid { grid-template-columns: 1fr; } }
"""


def render_summary(overall, days, period_label):
    comp = overall.get("comparison", {}) or {}
    dv_cls, dv_text = delta(overall["visitors"], comp.get("visitors"))
    dw_cls, dw_text = delta(overall["pageviews"], comp.get("pageviews"))
    bounce_now = pct_of(overall["bounces"], overall["visits"])
    bounce_prev = pct_of(comp.get("bounces", 0), comp.get("visits", 0))
    dur_now = fmt_duration(overall["totaltime"] / (overall["visits"] or 1))
    dur_prev = fmt_duration((comp.get("totaltime") or 0) / (comp.get("visits") or 1))
    bounce_cls = "up" if bounce_now <= bounce_prev else "down"
    return f"""
    <div class="card">
      <h2>今期間の概況<span class="sub">{esc(period_label)}</span></h2>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="label">Visitors（人数）</div>
          <div class="value">{overall['visitors']}</div>
          <div class="sub {dv_cls}">前期間{comp.get('visitors', '-')} → {dv_text}</div>
        </div>
        <div class="summary-item">
          <div class="label">Views（閲覧回数）</div>
          <div class="value">{overall['pageviews']}</div>
          <div class="sub {dw_cls}">前期間{comp.get('pageviews', '-')} → {dw_text}</div>
        </div>
        <div class="summary-item">
          <div class="label">直帰率</div>
          <div class="value">{bounce_now}%</div>
          <div class="sub {bounce_cls}">前期間{bounce_prev}%</div>
        </div>
        <div class="summary-item">
          <div class="label">平均滞在</div>
          <div class="value">{dur_now}</div>
          <div class="sub flat">前期間{dur_prev}</div>
        </div>
      </div>
    </div>"""


def render_pages(pages):
    ok_pages = [p for p in pages if not p.get("error")]
    rank_order = [p["key"] for p in sorted(ok_pages, key=lambda p: p["visitors"], reverse=True)]
    cards = []
    for p in pages:
        path_label = esc(p.get("path") or p.get("hostname", ""))
        if p.get("error"):
            cards.append(f"""
            <div class="pcard">
              <div class="phead"><span class="pname">{p['icon']} {esc(p['name'])}</span></div>
              <div class="ppath">{path_label}</div>
              <div class="fetch-fail">取得失敗・再読み込みしてね</div>
            </div>""")
            continue
        dvv_cls, dvv_text = delta(p["visitors"], p["prev_visitors"])
        dww_cls, dww_text = delta(p["views"], p["prev_views"])
        rank = rank_order.index(p["key"]) + 1
        rank_cls = "" if rank <= 3 else "g"
        ev_html = "".join(
            f'<div><span class="k">{esc(e["x"])}</span><span class="v">{e["y"]}</span></div>'
            for e in p["events"]
        ) or '<div><span class="k">カスタムイベント</span><span class="v">なし</span></div>'
        cards.append(f"""
        <div class="pcard">
          <div class="phead">
            <span class="rank {rank_cls}">{rank}位</span>
            <span class="pname">{p['icon']} {esc(p['name'])}</span>
          </div>
          <div class="ppath">{path_label}</div>
          <div class="pnums">
            <div class="pnum"><div class="n">{p['visitors']}</div><div class="t">Visitors</div><div class="d {dvv_cls}">{dvv_text}</div></div>
            <div class="pnum"><div class="n">{p['views']}</div><div class="t">Views</div><div class="d {dww_cls}">{dww_text}</div></div>
          </div>
          <div class="pev">{ev_html}</div>
        </div>""")
    return f"""
    <div class="card">
      <h2>\U0001F50E 7ページ並列比較</h2>
      <div class="page-grid">{''.join(cards)}</div>
    </div>"""


def render_hosts(hosts):
    rows = "".join(
        f'<tr><td>{esc(h["x"])}</td><td class="num">{h["y"]}</td></tr>' for h in hosts
    ) or '<tr><td colspan="2">データなし</td></tr>'
    return f"""
    <div class="card">
      <h2>\U0001F310 ホスト別</h2>
      <table><thead><tr><th>ホスト</th><th style="text-align:right;">Visitors</th></tr></thead>
      <tbody>{rows}</tbody></table>
    </div>"""


def render_utm(utm_rows):
    rows = "".join(
        f'<tr><td>{esc(k)}</td><td class="num">{v}</td></tr>' for k, v in utm_rows
    ) or '<tr><td colspan="2">この期間はUTM付き流入がありません</td></tr>'
    return f"""
    <div class="card">
      <h2>\U0001F3F7 UTM source別</h2>
      <table><thead><tr><th>utm_source</th><th style="text-align:right;">件数</th></tr></thead>
      <tbody>{rows}</tbody></table>
    </div>"""


def render_html(data):
    days = data["days"]
    fetched_at = time.strftime("%Y-%m-%d %H:%M:%S")
    start_date = time.strftime("%m/%d", time.localtime(data["start"] / 1000))
    end_date = time.strftime("%m/%d", time.localtime(data["end"] / 1000))
    period_label = f"{start_date}\u2013{end_date}（{days}日間・API実測）"

    body = "".join([
        render_summary(data["overall"], days, period_label),
        render_pages(data["pages"]),
        render_hosts(data["hosts"]),
        render_utm(data["utm_rows"]),
    ])

    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Umamiウォッチ週報</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>\U0001F4C8 Umamiウォッチ（週次スナップショット）</h1>
    <div class="meta">取得日時：{fetched_at}｜対象期間：{esc(period_label)}（静的スナップショット・自動更新なし・再生成は umami_snapshot.py を再実行）</div>
  </header>
  {body}
  <footer>耳で覚える宅建2026｜内部集計用スナップショット（{fetched_at} 生成）</footer>
</div>
</body>
</html>
"""


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    data = fetch_all(days)
    out_html = render_html(data)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(out_html)
    print(f"OK: {OUT_PATH} ({len(out_html)} bytes, {days}日間)")


if __name__ == "__main__":
    main()
