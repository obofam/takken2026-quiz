# -*- coding: utf-8 -*-
"""2026の回 → 2027の回への入口別 Umami 集計（takken.mimiobo.com）

使い方:
  python umami_to2027.py                      # 直近7日
  python umami_to2027.py 14                   # 直近14日
  python umami_to2027.py 2026-11-20 2026-11-30   # JSTの日付範囲（両端を含む）
  python umami_to2027.py 14 --csv C:\\out      # CSVも書く（UTF-8 BOM付き）
  python umami_to2027.py --selftest           # ダミー応答で表が組めるか検査
  オプション: --host ホスト名（既定 takken.mimiobo.com） / --all-hosts / --zero（データ0の行も出す）

取り方は umami_nichiji.py と同じ（Share URL のトークン方式・鍵は不要）。
【落とし穴】Umami は UTC で返す。/pageviews の x ラベルは使わず、
JSTの範囲を startAt/endAt にそのまま渡す。数字は country=JP のみ。

【APIで確かめたこと（2026-11-20）】
  使える : /stats（path・query・hostname・referrer のフィルタ）
           /metrics?type=path|event|query|referrer|hostname
           /event-data/values?event=&propertyName=（hostname・path で絞れる）
           /event-data/events?event=
  使えない: /stats の utm_source・utm_medium・utm_content フィルタ（無視されて全体が返る）
           → URLの query 文字列（完全一致）で代替
           /stats の event フィルタ（常に0）→ /metrics?type=event と /event-data/values で代替
           /sessions（401）・/metrics?type=url（400）
"""
import csv
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

SLUG = "AnWP6Ox8wWRpOqY1"
WID = "99a5370c-5fbd-4ceb-9d35-7734d7c580ec"
GW = "https://gateway-us.umami.is/api"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
JST = timezone(timedelta(hours=9))
DEFAULT_HOST = "takken.mimiobo.com"
TAIOU_CSV = (Path(__file__).resolve().parent.parent / "1_配信運用" / "2026と2027の対応表"
             / "対応表_2026の回から2027の回へ.csv")

ENTS = ["to2027", "stf", "note", "mail", "line", "direct"]
LISTEN_EVENTS = ["ep-spotify", "ep-spotify-show", "ep-app"]
MARK_EVENTS = ["ep-view", "ep-line"] + LISTEN_EVENTS
EP_RANGE = range(1, 42)

EXPLAIN = [
    "ep-view＝2027の回のページを開いた数（延べ）。ent＝来た入口、mark＝概要欄の印（utm_content）。",
    "to2027＝2026の回の概要欄／stf＝2027の概要欄のロードマップ等／direct＝目印なし（2027の概要欄からと読む）。",
    "LINE・聴く・メール＝ボタンを押した延べ回数（人数ではない）。訪問者・PV＝ページ（/ep/*）の実数。",
    "印別の訪問者は、URLの query 文字列ごとの合計（同じ人が別の query で来ると重複しうる）。",
]

CANNOT = [
    "UTM名指しのフィルタ（utm_source / utm_medium / utm_content）は共有URLでは無視される → query 文字列の一致で代替した",
    "/stats の event フィルタは常に0 → 件数は /metrics?type=event と /event-data/values で代替した",
    "/sessions は 401、/metrics?type=url は 400（使えない）",
    "出せないもの: 押した人の人数（イベントは延べ件数のみ）／印×入口の同時内訳／印ごとの view・ent のクロス",
]


# ---------- 低レベル ----------
class Api:
    """fetch(endpoint, params) -> JSON を差し替えられる薄い層。"""

    def __init__(self, fetch, start_ms, end_ms, host):
        self.fetch = fetch
        self.base = {"startAt": start_ms, "endAt": end_ms, "country": "JP"}
        self.host = host
        self.fails = []

    def call(self, ep, **p):
        params = {**self.base, **p}
        if self.host and "hostname" not in params:
            params["hostname"] = self.host
        try:
            return self.fetch(ep, params)
        except Exception as e:  # 空・失敗でも落とさない
            self.fails.append(f"{ep} {p}: {e}")
            return None

    def stats(self, **flt):
        r = self.call("/stats", **flt)
        if not isinstance(r, dict):
            return {"visitors": 0, "pageviews": 0}
        return {"visitors": r.get("visitors", 0) or 0, "pageviews": r.get("pageviews", 0) or 0}

    def metrics(self, typ, **flt):
        r = self.call("/metrics", type=typ, **flt)
        return r if isinstance(r, list) else []

    def values(self, event, prop, **flt):
        r = self.call("/event-data/values", event=event, propertyName=prop, **flt)
        return r if isinstance(r, list) else []


def make_real_fetch():
    def get(url, headers=None):
        req = urllib.request.Request(url, headers={**UA, **(headers or {})})
        last = None
        for _ in range(2):
            try:
                with urllib.request.urlopen(req, timeout=25) as r:
                    return json.load(r)
            except Exception as e:
                last = e
                time.sleep(0.5)
        raise last

    token = get(f"https://cloud.umami.is/analytics/us/api/share/{SLUG}")["token"]
    h = {"x-umami-share-token": token, "x-umami-share-context": SLUG}

    def fetch(ep, params):
        return get(f"{GW}/websites/{WID}{ep}?" + urllib.parse.urlencode(params), h)

    return fetch


# ---------- 対応表 ----------
def mark_of(url):
    q = urllib.parse.urlparse(url).query
    return (urllib.parse.parse_qs(q).get("utm_content") or [""])[0]


def load_taiou(path=TAIOU_CSV):
    """印 -> 題（表の順）。読めなければ空。"""
    marks, notes = {}, []
    try:
        with open(path, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                m = mark_of(row.get("2027のページURL（目印つき）", ""))
                if not m:
                    continue
                label = f"{row.get('2026の区分', '')}{row.get('2026の番号', '')} {(row.get('2026のタイトル') or '')[:30]}"
                if m in marks:
                    marks[m][1] += 1
                else:
                    marks[m] = [label, 1]
    except Exception as e:
        notes.append(f"対応表CSVを読めなかった（題は出さない）: {e}")
    return {m: (v[0] + (f"（他{v[1]-1}件）" if v[1] > 1 else "")) for m, v in marks.items()}, notes


# ---------- 集計 ----------
def queries_by_mark(api, path_flt):
    """指定パスの query 文字列から utm_content ごとに query 一覧を作る。"""
    out = defaultdict(list)
    for item in api.metrics("query", path=path_flt, limit=500):
        q = item.get("x", "")
        m = mark_of("?" + q)
        if m:
            out[m].append(q)
    return out


def table_a(api, taiou):
    ep_q = queries_by_mark(api, "c./ep/")
    rm_q = queries_by_mark(api, "/roadmap")
    ev = {name: {r.get("value"): r.get("total", 0) for r in api.values(name, "mark")} for name in MARK_EVENTS}
    marks = list(taiou) + sorted(
        {m for m in set(ep_q) | {k for d in ev.values() for k in d} if m and m not in taiou})
    rows = []
    for m in marks:
        v = p = 0
        for q in ep_q.get(m, []):
            s = api.stats(query=q, path="c./ep/")
            v += s["visitors"]
            p += s["pageviews"]
        rv = sum(api.stats(query=q, path="/roadmap")["visitors"] for q in rm_q.get(m, []))
        line = ev["ep-line"].get(m, 0)
        listen = sum(ev[n].get(m, 0) for n in LISTEN_EVENTS)
        rows.append({"印": m, "題": taiou.get(m, "（対応表に無い印）"), "回ページ訪問者": v, "回ページPV": p,
                     "ep-view": ev["ep-view"].get(m, 0), "LINE": line, "聴く": listen, "ロードマップ訪問者": rv})
    return rows


def active_eps(api):
    eps = set()
    for item in api.metrics("path", path="c./ep/", limit=500):
        m = re.match(r"^/ep/(\d+)(/|$)", item.get("x", ""))
        if m:
            eps.add(int(m.group(1)))
    for r in api.values("ep-view", "ep"):
        if str(r.get("value", "")).isdigit():
            eps.add(int(r["value"]))
    return sorted(e for e in eps if e in EP_RANGE)


def table_b(api):
    rows = []
    for n in active_eps(api):
        pth = f"/ep/{n}"
        s = api.stats(path=pth)
        ents = {r.get("value"): r.get("total", 0) for r in api.values("ep-view", "ent", path=pth)}
        evs = {r.get("x"): r.get("y", 0) for r in api.metrics("event", path=pth, limit=500)}
        view = evs.get("ep-view", 0)
        known = {e: ents.get(e, 0) for e in ENTS}
        other = max(view - sum(known.values()), 0) if view else sum(
            v for k, v in ents.items() if k not in ENTS)
        rows.append({"回": n, "訪問者": s["visitors"], "PV": s["pageviews"], "ep-view": view, **known,
                     "その他": other, "LINE": evs.get("ep-line", 0),
                     "聴く": sum(evs.get(k, 0) for k in LISTEN_EVENTS),
                     "メール": evs.get("ep-mail", 0), "○×完了": evs.get("ep-ox-done", 0)})
    return rows


def table_c(api):
    tot = api.stats(path="/roadmap")
    gy = api.stats(path="/roadmap", query="c.utm_content=gaiyou")
    evs = {r.get("x"): r.get("y", 0) for r in api.metrics("event", path="/roadmap", limit=500)}
    return [{"入口": "概要欄（utm_source=stf&utm_content=gaiyou）", "訪問者": gy["visitors"], "PV": gy["pageviews"]},
            {"入口": "その他の入口", "訪問者": max(tot["visitors"] - gy["visitors"], 0),
             "PV": max(tot["pageviews"] - gy["pageviews"], 0)},
            {"入口": "合計", "訪問者": tot["visitors"], "PV": tot["pageviews"]},
            {"入口": "roadmap-line（LINEを押した延べ数）", "訪問者": "", "PV": evs.get("roadmap-line", 0)},
            {"入口": "roadmap-mail（メールを押した延べ数）", "訪問者": "", "PV": evs.get("roadmap-mail", 0)}]


# ---------- 表示 ----------
def width(s):
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in str(s))


def pad(s, w, right=False):
    s = str(s)
    sp = " " * max(w - width(s), 0)
    return sp + s if right else s + sp


def render(rows, cols, left=()):
    if not rows:
        return "  （データなし）"
    ws = [max(width(c), *(width(r.get(c, "")) for r in rows)) for c in cols]
    head = "  " + "  ".join(pad(c, w, c not in left) for c, w in zip(cols, ws))
    lines = [head, "  " + "  ".join("-" * w for w in ws)]
    for r in rows:
        lines.append("  " + "  ".join(pad(r.get(c, ""), w, c not in left) for c, w in zip(cols, ws)))
    return "\n".join(lines)


A_COLS = ["印", "題", "回ページ訪問者", "回ページPV", "LINE", "聴く", "ロードマップ訪問者"]
B_COLS = ["回", "訪問者", "PV", "ep-view"] + ENTS + ["その他", "LINE", "聴く", "メール", "○×完了"]
C_COLS = ["入口", "訪問者", "PV"]


def build(api, taiou, show_zero=False):
    a_all = table_a(api, taiou)
    a = [r for r in a_all if show_zero or any(r[k] for k in ("回ページ訪問者", "回ページPV", "ep-view", "LINE", "聴く", "ロードマップ訪問者"))]
    return a, len(a_all) - len(a), table_b(api), table_c(api)


def report(api, taiou, notes, label, show_zero=False):
    a, a_zero, b, c = build(api, taiou, show_zero)
    out = [f"=== 2027の回への入口別（日本のみ・JST）{label}  ホスト: {api.host or '全部'} ===", "",
           "【この数字は何を見ているか】"] + ["  " + t for t in EXPLAIN] + [""]
    out += ["A. 2026の回ごと（印＝utm_content）", render(a, A_COLS, left=("印", "題"))]
    if a_zero:
        out.append(f"  （この期間データなしの印: {a_zero}件。--zero で表示）")
    out += ["", "B. 2027の回ごと（/ep/1〜/ep/41・データのある回のみ）", render(b, B_COLS)]
    out.append(f"  （データなしの回: {len(EP_RANGE) - len(b)}回）")
    out += ["", "C. ロードマップ（/roadmap）", render(c, C_COLS, left=("入口",)), ""]
    out += ["【できなかったこと】"] + ["  ・" + t for t in CANNOT + notes]
    if api.fails:
        out.append(f"  ・APIが失敗した呼び出し {len(api.fails)}件（例: {api.fails[0][:120]}）")
    return "\n".join(out), (a, b, c)


def write_csv(folder, tables):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for name, cols, rows in (("A_2026の回ごと", A_COLS, tables[0]), ("B_2027の回ごと", B_COLS, tables[1]),
                             ("C_ロードマップ", C_COLS, tables[2])):
        p = folder / f"umami_to2027_{name}.csv"
        with open(p, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        print(f"CSV: {p}")


# ---------- 範囲 ----------
def parse_range(args, now):
    dates = [a for a in args if re.fullmatch(r"\d{4}-\d{2}-\d{2}", a)]
    if len(dates) >= 1:
        d0 = datetime.strptime(dates[0], "%Y-%m-%d").replace(tzinfo=JST)
        d1 = datetime.strptime(dates[-1], "%Y-%m-%d").replace(tzinfo=JST) + timedelta(days=1)
        return d0, min(d1, now)
    nums = [a for a in args if a.isdigit()]
    days = int(nums[0]) if nums else 7
    d0 = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return d0, now


# ---------- セルフテスト ----------
def make_fake():
    """ダミーのページビュー・イベントから Umami 風の応答を返す。"""
    pv = [  # (path, query, session)
        ("/ep/6", "utm_source=stf&utm_medium=to2027&utm_content=ep2", "s1"),
        ("/ep/6", "utm_source=stf&utm_medium=to2027&utm_content=ep2", "s2"),
        ("/ep/6", "utm_source=stf&utm_medium=to2027&utm_content=ep2", "s2"),
        ("/ep/1", "utm_source=stf&utm_medium=to2027&utm_content=ep7", "s3"),
        ("/ep/1", "utm_source=stf&utm_medium=to2027&utm_content=zzz9", "s4"),
        ("/ep/3", "", "s5"),
        ("/roadmap", "utm_source=stf&utm_content=gaiyou", "s6"),
        ("/roadmap", "utm_source=stf&utm_content=gaiyou", "s7"),
        ("/roadmap", "", "s8"),
    ]
    evs = [  # (event, path, props)
        ("ep-view", "/ep/6", {"ep": "6", "ent": "to2027", "mark": "ep2"}),
        ("ep-view", "/ep/6", {"ep": "6", "ent": "to2027", "mark": "ep2"}),
        ("ep-view", "/ep/1", {"ep": "1", "ent": "to2027", "mark": "ep7"}),
        ("ep-view", "/ep/1", {"ep": "1", "ent": "to2027", "mark": "zzz9"}),
        ("ep-view", "/ep/3", {"ep": "3", "ent": "direct", "mark": ""}),
        ("ep-view", "/ep/3", {"ep": "3", "ent": "note", "mark": ""}),
        ("ep-view", "/ep/3", {"ep": "3", "mark": ""}),
        ("ep-line", "/ep/6", {"ep": "6", "ent": "to2027", "mark": "ep2"}),
        ("ep-spotify", "/ep/6", {"ep": "6", "ent": "to2027", "mark": "ep2"}),
        ("ep-app", "/ep/6", {"ep": "6", "ent": "to2027", "mark": "ep2", "app": "apple"}),
        ("ep-spotify-show", "/ep/1", {"ep": "1", "ent": "to2027", "mark": "ep7"}),
        ("ep-mail", "/ep/3", {"ep": "3", "ent": "direct", "mark": ""}),
        ("ep-ox-done", "/ep/3", {"ep": "3", "ent": "direct", "mark": ""}),
        ("roadmap-line", "/roadmap", {"ent": "roadmap"}),
        ("roadmap-mail", "/roadmap", {"ent": "roadmap"}),
        ("roadmap-mail", "/roadmap", {"ent": "roadmap"}),
    ]

    def match(val, flt):
        if flt is None:
            return True
        if flt.startswith("c."):
            return flt[2:] in val
        if flt.startswith("eq."):
            return val == flt[3:]
        return val == flt

    def fetch(ep, p):
        pf, qf = p.get("path"), p.get("query")
        rows = [x for x in pv if match(x[0], pf) and match(x[1], qf)]
        if ep == "/stats":
            return {"pageviews": len(rows), "visitors": len({x[2] for x in rows})}
        if ep == "/metrics":
            t = p["type"]
            if t == "query":
                c = defaultdict(int)
                for x in rows:
                    if x[1]:
                        c[x[1]] += 1
                return [{"x": k, "y": v} for k, v in c.items()]
            if t == "path":
                c = defaultdict(int)
                for x in rows:
                    c[x[0]] += 1
                return [{"x": k, "y": v} for k, v in c.items()]
            if t == "event":
                c = defaultdict(int)
                for n, path, _ in evs:
                    if match(path, pf):
                        c[n] += 1
                return [{"x": k, "y": v} for k, v in c.items()]
        if ep == "/event-data/values":
            c = defaultdict(int)
            for n, path, props in evs:
                if n == p["event"] and match(path, pf) and p["propertyName"] in props:
                    c[props[p["propertyName"]]] += 1
            return [{"value": k, "total": v} for k, v in c.items()]
        raise ValueError("fake: " + ep)

    return fetch


def selftest():
    taiou = {"ep2": "本編#2 【業法】35条書面と37条書面", "ep7": "本編#7 欠格事由", "hokyo1": "補強#1 ダミー"}
    api = Api(make_fake(), 0, 1, DEFAULT_HOST)
    a, a_zero, b, c = build(api, taiou)
    am = {r["印"]: r for r in a}
    checks = [
        ("A ep2 訪問者=2・PV=3", am["ep2"]["回ページ訪問者"] == 2 and am["ep2"]["回ページPV"] == 3),
        ("A ep2 LINE=1・聴く=2", am["ep2"]["LINE"] == 1 and am["ep2"]["聴く"] == 2),
        ("A ep7 聴く=1（spotify-show）", am["ep7"]["聴く"] == 1),
        ("A 対応表に無い印 zzz9 が末尾に出る", a[-1]["印"] == "zzz9" and a[-1]["題"] == "（対応表に無い印）"),
        ("A データなしの印 hokyo1 は省かれる", "hokyo1" not in am and a_zero == 1),
        ("A 対応表に無い印のうちロードマップだけの印(gaiyou)は出さない", "gaiyou" not in am),
        ("B 取り上げる回 = 1,3,6", [r["回"] for r in b] == [1, 3, 6]),
        ("B ep6 to2027=2・その他0", b[2]["to2027"] == 2 and b[2]["その他"] == 0),
        ("B ep3 direct=1・note=1・その他=1（ent無し）", b[1]["direct"] == 1 and b[1]["note"] == 1 and b[1]["その他"] == 1),
        ("B ep3 メール=1・○×=1", b[1]["メール"] == 1 and b[1]["○×完了"] == 1),
        ("C 概要欄=2・その他=1・合計=3", (c[0]["訪問者"], c[1]["訪問者"], c[2]["訪問者"]) == (2, 1, 3)),
        ("C roadmap-line=1・mail=2", c[3]["PV"] == 1 and c[4]["PV"] == 2),
    ]
    # 空データでも壊れない
    empty = Api(lambda ep, p: [] if ep != "/stats" else {}, 0, 1, DEFAULT_HOST)
    ea, _, eb, ec = build(empty, taiou)
    checks.append(("空の応答で例外なし・A/Bは空", ea == [] and eb == [] and ec[2]["訪問者"] == 0))
    err = Api(lambda ep, p: (_ for _ in ()).throw(RuntimeError("x")), 0, 1, DEFAULT_HOST)
    build(err, taiou)
    checks.append(("APIエラーでも例外なし", len(err.fails) > 0))
    text, _ = report(api, taiou, [], "selftest")
    checks.append(("画面出力が組める", "A. 2026の回ごと" in text and "できなかったこと" in text))
    t, notes = load_taiou()
    checks.append((f"対応表CSVを読める（印{len(t)}件）", bool(t) and not notes))
    bad = [n for n, ok in checks if not ok]
    for n, ok in checks:
        print(("OK  " if ok else "NG  ") + n)
    print("selftest:", "通過" if not bad else f"失敗 {len(bad)}件")
    return not bad


def main():
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    args = sys.argv[1:]
    if "--selftest" in args:
        sys.exit(0 if selftest() else 1)
    csv_dir = None
    if "--csv" in args:
        i = args.index("--csv")
        csv_dir = args[i + 1] if i + 1 < len(args) else None
        args = args[:i] + args[i + 2:]
    host = DEFAULT_HOST
    if "--host" in args:
        i = args.index("--host")
        host = args[i + 1]
        args = args[:i] + args[i + 2:]
    if "--all-hosts" in args:
        host = None
        args.remove("--all-hosts")
    zero = "--zero" in args
    args = [a for a in args if a != "--zero"]

    now = datetime.now(JST)
    d0, d1 = parse_range(args, now)
    label = f"{d0:%Y-%m-%d %H:%M}〜{d1:%Y-%m-%d %H:%M}"
    try:
        fetch = make_real_fetch()
    except Exception as e:
        print(f"Umami に接続できなかった: {e}")
        sys.exit(1)
    api = Api(fetch, int(d0.timestamp() * 1000), int(d1.timestamp() * 1000), host)
    taiou, notes = load_taiou()
    text, tables = report(api, taiou, notes, label, zero)
    print(text)
    if csv_dir:
        write_csv(csv_dir, tables)


if __name__ == "__main__":
    main()
