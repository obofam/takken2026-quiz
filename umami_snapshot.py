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

OUT_PATH = r"C:\Claude\宅建\7_クイズと進捗トラッカー\umami_snapshot.html"

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

QUIZ_HOST = "takken2026-quiz.vercel.app"
# 進捗トラッカーは旧URL(obofam.github.io)とvercel版が二重に生きている（導線監査の穴07）
TRACKER_HOSTS = ["obofam.github.io", QUIZ_HOST]
# 2026-08-27 独自ドメイン移行。旧 mimiobo.vercel.app も生きている（308でwwwへ）ため両方を合算する
HOME_HOSTS = ["www.mimiobo.com", "mimiobo.vercel.app"]

# 7ページ定義（umami_watch.html と同じ構造）
# path は必ず hostnames とセットで指定する。ホストを指定しないと、複数ホストで
# 同じパスが存在する場合に合算されてしまう（特に "/" はクイズトップとメインHPトップが
# 混ざり実数の数倍になる。2026-08-31 の週報で実際に起きた）。
PAGE_DEFS = [
    {"key": "tracker", "name": "進捗トラッカー", "icon": "\U0001F4CA",
     "path": "/takken2026-quiz/tracker.html", "hostnames": TRACKER_HOSTS,
     "prefixes": ["tracker_", "progress_toggle", "revisit", "stand_fm", "note_summary"]},
    {"key": "kyozai", "name": "教材一覧", "icon": "\U0001F5C2",
     "path": "/kyozai.html", "hostnames": [QUIZ_HOST],
     "prefixes": ["kyozai_"]},
    {"key": "weekly", "name": "週1過去問コーナー", "icon": "\U0001F4DD",
     "path": "/weekly.html", "hostnames": [QUIZ_HOST],
     "prefixes": ["weekly_", "週1問_回答"]},
    {"key": "quiz", "name": "一問一答問題集", "icon": "\U0001F4DA",
     "path": "/", "hostnames": [QUIZ_HOST],
     "prefixes": ["sample_", "buyguide_", "modal_", "knock_"]},
    {"key": "omikuji", "name": "おみくじ", "icon": "\U0001F3B2",
     "path": "/omikuji.html", "hostnames": [QUIZ_HOST],
     "prefixes": ["omikuji_"]},
    {"key": "shindan", "name": "現在地診断", "icon": "\U0001F9ED",
     "path": "/shindan.html", "hostnames": [QUIZ_HOST],
     "prefixes": ["shindan_"]},
    {"key": "home", "name": "メインHP", "icon": "\U0001F3E0", "hostnames": HOME_HOSTS,
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


def top_events_for(prefixes, event_list, n=5, want_out=None):
    matched = [e for e in event_list if matches_prefixes(e["x"], prefixes)]
    if want_out is not None:
        matched = [e for e in matched if is_outbound(e["x"]) == want_out]
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


# 「送り先」＝そのページから外へ出ていくCTA。それ以外は「中の動き」に回す。
OUTBOUND_HINTS = ("_cta_", "_nav_", "_link", "_plat_", "_sns_", "_ep_", "_mat_",
                  "_tokushoho", "_share", "_mail_")
# 名前からは判別できないが外部へ飛ばしているもの（stand.fm / note の各記事）
OUTBOUND_NAMES = {"stand_fm", "note_summary"}


def is_outbound(name):
    return name in OUTBOUND_NAMES or any(hint in name for hint in OUTBOUND_HINTS)


def collect_inbound(d, base_params, headers):
    """そのページ「どこから来たか」。リファラとUTM sourceを1本のリストにまとめる。"""
    tally = {}
    for hn in d["hostnames"]:
        params = {**base_params, "hostname": hn}
        if "path" in d:
            params["path"] = d["path"]
        for typ in ("referrer", "query"):
            try:
                rows = api_get("/metrics", {**params, "type": typ, "limit": 20}, headers)
            except Exception:
                continue
            for r in rows:
                x, y = r["x"], r["y"]
                if not x:
                    continue
                if typ == "query":
                    src = urllib.parse.parse_qs(x).get("utm_source", [None])[0]
                    if not src:
                        continue
                    label = src
                else:
                    label = x.replace("www.", "").replace("m.facebook.com", "facebook.com")
                    label = label.replace("l.instagram.com", "instagram.com")
                tally[label] = tally.get(label, 0) + y
    return sorted(tally.items(), key=lambda kv: kv[1], reverse=True)[:4]


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
            # ホストごとに引いて合算する（旧URL/新ドメインでデータが分断されるため）。
            # path があれば hostname と AND で絞る＝同名パスの他ホスト混入を防ぐ。
            vis = views = prev_vis = prev_views = 0
            for hn in d["hostnames"]:
                params = {**base_params, "hostname": hn}
                if "path" in d:
                    params["path"] = d["path"]
                st = api_get("/stats", params, headers)
                cp = st.get("comparison", {}) or {}
                vis += st["visitors"]
                views += st["pageviews"]
                prev_vis += cp.get("visitors") or 0
                prev_views += cp.get("pageviews") or 0
            stat = {"visitors": vis, "pageviews": views}
            comp = {"visitors": prev_vis, "pageviews": prev_views}
            inbound = collect_inbound(d, base_params, headers)
            pages.append({
                "inbound": inbound,
                **d,
                "visitors": stat["visitors"], "views": stat["pageviews"],
                "prev_visitors": comp.get("visitors"), "prev_views": comp.get("pageviews"),
                "events_inside": top_events_for(d["prefixes"], events, 3, want_out=False),
                "events_out": top_events_for(d["prefixes"], events, 4, want_out=True),
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
.pcard .pev .k { color: #6b7a80; overflow-wrap: anywhere; }
.pcard .pev .v { font-variant-numeric: tabular-nums; font-weight: 600; color: #2b3438; }
.pcard .pblock + .pblock { margin-top: 8px; padding-top: 7px; border-top: 1px dotted #e8eff0; }
.pcard .blabel { font-size: 10.5px; font-weight: 700; letter-spacing: .02em; margin-bottom: 3px; }
.pcard .blabel.bin { color: #1c7ea8; }
.pcard .blabel.bmid { color: #7c8b8f; }
.pcard .blabel.bout { color: #b06a1f; }
.pcard .pev .none { color: #b3c0c4; font-size: 12px; font-style: italic; }
.rank { font-size: 11px; color: #ffffff; background: #17a2af; border-radius: 999px; padding: 1px 7px; font-weight: 700; }
.rank.g { background: #cbd6d8; color: #5c6c70; }
.fetch-fail { font-size: 13px; color: #b4553f; background: #fdf1ee; border-radius: 8px; padding: 10px 12px; }
.notice { background: #fff8e8; border: 1px solid #f0dfb8; border-radius: 12px; padding: 14px 18px; margin-bottom: 16px; }
.notice h3 { font-size: 14px; margin: 0 0 8px; color: #8a6410; }
.notice ul { margin: 0; padding-left: 1.1em; font-size: 13px; color: #5c5240; line-height: 1.8; }
.notice code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; background: #fdf3dd; padding: 1px 4px; border-radius: 3px; }
footer { text-align: center; font-size: 12px; color: #9aa7ab; margin-top: 24px; }
@media (max-width: 1000px) { .page-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 900px) { .summary-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 620px) { .page-grid { grid-template-columns: 1fr; } }
"""


# 週報に常設する「読み方の注意」。状況が変わったらここを直す（HTMLを手で書き足さない）。
# 空リストにすればブロックごと消える。
NOTICE_ITEMS = [
    "<b>7ページ比較はホスト＋パスで絞って集計している。</b>"
    "以前は <code>/</code> をホスト横断で合算していたため、"
    "「一問一答問題集」にメインHPのトップが混ざって実数の数倍に見えていた（2026-08-31の週報で発覚・修正済み）。",
    "<b>進捗トラッカーは <code>obofam.github.io</code> が正。</b>"
    "学習記録の蓄積がこのURLに紐づいているため、意図的にGitHub Pages側を本番にしている"
    "（vercel版への一本化は来期）。ここでは念のため両ホストを合算しているが、"
    "実質は obofam.github.io 側がほぼ全数。",
    "<b>メインHPは <code>www.mimiobo.com</code>（本番）と旧 <code>mimiobo.vercel.app</code>（308でwwwへ転送）の合算。</b>"
    "2026-08-26週から計測に合流したので、それ以前との比較では丸ごと上積みになる。",
    "<b>メール導線（Kit）はUmamiの外側。</b>"
    "登録・開封・クリックはKitの管理画面にあり、この週報には出ない（穴06）。"
    "読者数は <code>umami_週次ログ.md</code> のメルマガ表を見る。",
]


def render_notice():
    if not NOTICE_ITEMS:
        return ""
    lis = "".join(f"<li>{item}</li>" for item in NOTICE_ITEMS)
    return f"""
    <div class="notice">
      <h3>⚠️ この週報の数字を読むときの注意</h3>
      <ul>{lis}</ul>
    </div>"""


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
        hosts_label = " + ".join(p["hostnames"])
        path_label = esc(f"{hosts_label}{p['path']}" if "path" in p else hosts_label)
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
        def rows(items, empty):
            if not items:
                return f'<div class="none">{empty}</div>'
            return "".join(
                f'<div><span class="k">{esc(k)}</span><span class="v">{v}</span></div>'
                for k, v in items
            )

        ev_html = (
            '<div class="pblock"><div class="blabel bin">← どこから来たか</div>'
            + rows(p["inbound"], "直接／リファラなし")
            + '</div><div class="pblock"><div class="blabel bmid">◆ 中の動き</div>'
            + rows([(e["x"], e["y"]) for e in p["events_inside"]], "計測イベントなし")
            + '</div><div class="pblock"><div class="blabel bout">→ どこへ行ったか</div>'
            + rows([(e["x"], e["y"]) for e in p["events_out"]], "送り先クリック 0")
            + '</div>'
        )
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
        render_notice(),
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
