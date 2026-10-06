# -*- coding: utf-8 -*-
"""法令上の制限 第22〜27回・税その他 第28〜31回 3問チェック（hourei_zei_ep22-31.json）の正解を
e-Gov 法令API v2 で照合する。

基準日 2026-04-01 の版（asof）で条文を取り、正解の根拠になる語句が本文にあるか（must）、
誤りの根拠になる語句が無いか（absent）を確認する。
条の指定は "7"（本則 第7条）、"5_2"（第5条の2）、"SUPPL-P2"（制定時附則 第2項）、
"APPDX1"（別表第一。法令全文を取って最初の AppdxTable を使う）。
不動産鑑定評価基準・公正競争規約は e-Gov の収録外のため対象外（要確認）。
第25回（建ぺい率・容積率）は素材が2問しかないため保留（この JSON に含めない）。
使い方: python egov_verify_hourei_zei.py
"""
import sys, json, re, urllib.request

sys.stdout.reconfigure(encoding="utf-8")
ASOF = "2026-04-01"
TOKEI = "343AC0000000100"      # 都市計画法
TOKEI_REI = "344CO0000000158"  # 都市計画法施行令
KENKI = "325AC0000000201"      # 建築基準法
KENKI_REI = "325CO0000000338"  # 建築基準法施行令
NOCHI = "327AC0000000229"      # 農地法
KOKUDO = "349AC1000000092"     # 国土利用計画法（349AC0000000092 ではない。e-Gov 検索で確認）
KUKAKU = "329AC0000000119"     # 土地区画整理法
MORIDO = "336AC0000000191"     # 宅地造成及び特定盛土等規制法
MORIDO_REI = "337CO0000000016" # 宅地造成及び特定盛土等規制法施行令
CHIHO = "325AC0000000226"      # 地方税法
INSHI = "342AC0000000023"      # 印紙税法
TOUMEN = "342AC0000000035"     # 登録免許税法
SOCHI = "332AC0000000026"      # 租税特別措置法
CHIKA = "344AC0000000049"      # 地価公示法
KIKO = "417AC0000000082"       # 独立行政法人住宅金融支援機構法

# (問題id, [(法令ID, 条, [あるべき語句], [無いはずの語句])])
CHECKS = [
    ("ep22-q1", [(TOKEI, "7", ["市街化区域は、すでに市街地を形成している区域及びおおむね十年以内に優先的かつ計画的に市街化を図るべき区域とする", "市街化調整区域は、市街化を抑制すべき区域とする"], [])]),
    ("ep22-q2", [(TOKEI, "13", ["市街化区域については、少なくとも用途地域を定めるものとし、市街化調整区域については、原則として用途地域を定めないものとする"], []),
                 (TOKEI, "8", ["都市計画区域については、都市計画に、次に掲げる地域、地区又は街区を定めることができる", "準都市計画区域については、都市計画に、前項第一号"], [])]),
    ("ep22-q3", [(TOKEI, "5_2", ["都道府県は、都市計画区域外の区域のうち"], [])]),
    ("ep23-q1", [(TOKEI, "29", ["一市街化区域、区域区分が定められていない都市計画区域又は準都市計画区域内において行う開発行為で、その規模が"], []),
                 (TOKEI_REI, "19", ["市街化区域千平方メートル", "三百平方メートル以上千平方メートル未満", "「千平方メートル」とあるのは、「五百平方メートル」とする"], [])]),
    ("ep23-q2", [(TOKEI, "29", ["一市街化区域、区域区分が定められていない都市計画区域又は準都市計画区域内において行う開発行為で、その規模が"], ["一市街化調整区域"])]),
    ("ep23-q3", [(TOKEI, "4", ["ゴルフコースその他大規模な工作物で政令で定めるもの（以下「第二種特定工作物」という。）"], []),
                 (TOKEI_REI, "1", ["法第四条第十一項の大規模な工作物で政令で定めるものは、次に掲げるもので、その規模が一ヘクタール以上のものとする。一野球場、庭球場"], ["ゴルフコース"])]),
    ("ep24-q1", [(KENKI, "41_2", ["この章（第八節を除く。）の規定は、都市計画区域及び準都市計画区域内に限り、適用する"], [])]),
    ("ep24-q2", [(KENKI, "28", ["採光のための窓その他の開口部を設け"], []),
                 (KENKI_REI, "19", ["住宅の居住のための居室七分の一", "十分の一までの範囲内において国土交通大臣が別に定める割合"], [])]),
    ("ep24-q3", [(KENKI_REI, "107_2", ["柱四十五分間", "はり四十五分間", "屋根（軒裏を除く。）三十分間", "階段三十分間"], [])]),
    ("ep26-q1", [(NOCHI, "3", ["当事者が農業委員会の許可を受けなければならない"], ["市街化区域"]),
                 (NOCHI, "4", ["七市街化区域", "あらかじめ農業委員会に届け出て、農地以外のものにする場合"], []),
                 (NOCHI, "5", ["六前条第一項第七号に規定する市街化区域内にある農地又は採草放牧地につき、政令で定めるところによりあらかじめ農業委員会に届け出て"], [])]),
    ("ep26-q2", [(NOCHI, "3_3", ["同項の許可を受けてこれらの権利を取得した場合", "遅滞なく", "農業委員会にその旨を届け出なければならない"], [])]),
    ("ep26-q3", [(NOCHI, "4", ["以下「都道府県知事等」という。）の許可を受けなければならない"], ["農林水産大臣の許可"]),
                 (NOCHI, "SUPPL-P2", ["都道府県知事等は、当分の間、次に掲げる場合には、あらかじめ、農林水産大臣に協議しなければならない", "四ヘクタールを超える農地を農地以外のものにする行為"], [])]),
    ("ep27-q1", [(KOKUDO, "23", ["当事者のうち当該土地売買等の契約により土地に関する権利の移転又は設定を受けることとなる者", "その契約を締結した日から起算して二週間以内に"], [])]),
    ("ep27-q2", [(KUKAKU, "18", ["所有権を有するすべての者及びその区域内の宅地について借地権を有するすべての者のそれぞれの三分の二以上の同意を得なければならない", "三分の二以上でなければならない"], [])]),
    ("ep27-q3", [(MORIDO, "12", ["都道府県知事の許可"], []),
                 (MORIDO_REI, "3", ["一盛土であつて、当該盛土をした土地の部分に高さが一メートルを超える崖", "二切土であつて、当該切土をした土地の部分に高さが二メートルを超える崖"], [])]),
    ("ep28-q1", [(CHIHO, "73_7", ["不動産取得税を課することができない", "一相続（包括遺贈及び被相続人から相続人に対してなされた遺贈を含む。）による不動産の取得"], [])]),
    ("ep28-q2", [(CHIHO, "343", ["固定資産税は、固定資産の所有者", "登記簿又は土地補充課税台帳若しくは家屋補充課税台帳に所有者", "として登記又は登録がされている者をいう"], []),
                 (CHIHO, "359", ["固定資産税の賦課期日は、当該年度の初日の属する年の一月一日とする"], ["四月一日"])]),
    ("ep28-q3", [(CHIHO, "349_3_2", ["当該住宅用地に係る固定資産税の課税標準となるべき価格の三分の一の額とする", "小規模住宅用地", "六分の一の額とする", "二百平方メートル以下"], [])]),
    ("ep29-q1", [(INSHI, "APPDX1", ["２地上権又は土地の賃借権の設定又は譲渡に関する契約書"], ["賃貸借"])]),
    ("ep29-q2", [(SOCHI, "73", ["令和九年三月三十一日までの間", "売買その他の政令で定める原因", "千分の三とする"], []),
                 (TOUMEN, "APPDX1", ["ハその他の原因による移転の登記不動産の価額千分の二十"], [])]),
    ("ep29-q3", [(SOCHI, "31", ["その年一月一日において所有期間が五年を超えるもの"], []),
                 (SOCHI, "32", ["その年一月一日において第三十一条第二項に規定する所有期間が五年以下であるもの"], [])]),
    ("ep30-q2", [(CHIKA, "2", ["二人以上の不動産鑑定士の鑑定評価を求め"], [])]),
    ("ep30-q3", [(CHIKA, "1_2", ["土地の取引を行なう者は", "公示された価格を指標として取引を行なうよう努めなければならない"], []),
                 (CHIKA, "8", ["公示価格」という。）を規準としなければならない"], []),
                 (CHIKA, "9", ["公示価格を規準としなければならない"], [])]),
    ("ep31-q1", [(KIKO, "13", ["金融機関の貸付債権の譲受けを行うこと", "特定債務保証"], [])]),
    ("ep31-q2", [(KIKO, "13", ["五災害復興建築物の建設若しくは購入又は被災建築物の補修に必要な資金", "の貸付けを行うこと"], [])]),
]
# e-Gov で照合できない、または条文だけでは結論が出ないもの
NEEDS_REVIEW = {
    "ep26-q2": "3条の3（許可を受けずに権利を取得した者の届出義務）は確認。相続が3条の許可不要である点は条文に明記がなく解釈による",
    "ep30-q1": "不動産鑑定評価基準（総論第7章・原価法の減価要因）は国土交通省の通知で、e-Gov法令APIの収録外",
    "ep31-q3": "徒歩所要時間の端数切上げは不動産の表示に関する公正競争規約施行規則9条9号にあり、業界の自主規約でe-Gov法令APIの収録外",
}
CHECKS += [(qid, []) for qid in NEEDS_REVIEW if qid not in dict(CHECKS)]
CHECKS.sort(key=lambda c: tuple(int(x) for x in re.findall(r"\d+", c[0])))


def text_of(node, out):
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, dict):
        if node.get("tag") == "Rt":
            return
        for c in node.get("children", []):
            text_of(c, out)
    elif isinstance(node, list):
        for c in node:
            text_of(c, out)


def find_tag(node, tag):
    if isinstance(node, dict):
        if node.get("tag") == tag:
            return node
        for c in node.get("children", []):
            r = find_tag(c, tag)
            if r is not None:
                return r
    return None


def fetch(law, elm=None):
    q = f"?asof={ASOF}&response_format=json" + (f"&elm={elm}" if elm else "")
    with urllib.request.urlopen(f"https://laws.e-gov.go.jp/api/2/law_data/{law}{q}", timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


_cache = {}


def article(law, art):
    key = (law, art)
    if key not in _cache:
        if art == "APPDX1":
            d = fetch(law)
            node = find_tag(d.get("law_full_text"), "AppdxTable")
        elif art.startswith("SUPPL-P"):
            d = fetch(law, f"SupplProvision-Paragraph_{art[7:]}")
            node = d.get("law_full_text")
        else:
            d = fetch(law, f"MainProvision-Article_{art}")
            node = d.get("law_full_text")
        out = []
        text_of(node, out)
        _cache[key] = (re.sub(r"\s+", "", "".join(out)), d["revision_info"]["law_revision_id"])
    return _cache[key]


def label(art):
    if art == "APPDX1":
        return "別表第一"
    if art.startswith("SUPPL-P"):
        return f"附則第{art[7:]}項"
    head, *rest = art.split("_")
    return f"第{head}条" + "".join(f"の{x}" for x in rest)


def main():
    ok = ng = 0
    for qid, specs in CHECKS:
        problems, notes = [], []
        for law, art, must, absent in specs:
            try:
                t, rev = article(law, art)
            except Exception as e:  # 取得失敗は NG 扱い
                problems.append(f"{law} {label(art)} 取得失敗: {e}")
                continue
            if not t:
                problems.append(f"{law} {label(art)} 本文が空")
            notes.append(f"{rev} {label(art)}")
            for k in must:
                if k not in t:
                    problems.append(f"{label(art)}に「{k}」が無い")
            for k in absent:
                if k in t:
                    problems.append(f"{label(art)}に「{k}」がある")
        if problems:
            status = "NG"; ng += 1
        elif qid in NEEDS_REVIEW:
            status = "要確認"
        else:
            status = "条文照合OK"; ok += 1
        print(f"{qid}\t{status}\t{' / '.join(notes)}")
        for p in problems:
            print("   !", p)
        if qid in NEEDS_REVIEW:
            print("   -", NEEDS_REVIEW[qid])
    print(f"\n照合OK {ok} / 要確認 {len(NEEDS_REVIEW)} / NG {ng}（基準日 {ASOF}）")
    return 1 if ng else 0


if __name__ == "__main__":
    sys.exit(main())
