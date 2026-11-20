// 回のページ（図解と3問）の build の設定。build-ep.mjs が読む。
// 材料（やさしいテキスト・流し込み材料 json）には置かない値と、第1回だけの手作りの所を、ここに集める。

// LIFF ID：本番（takken.mimiobo.com）と試し用（liff-test の Vercel プロジェクト）で違う
export const LIFF_ID = { prod: '2012583516-7vmvMorb', test: '2011606963-hH0DzETc' };

// Spotify：回ごとの住所がまだ無いので、全回とも番組の住所。
// 回ごとの住所ができたら、ここに { 2: 'https://open.spotify.com/episode/…' } と足す（材料側には書かない）。
// 足すと、その回の「聴く」ボタンは「この回を聴く（Spotify）」になり、「いまは番組のページが開きます」の注記は出なくなる。
export const SPOTIFY_SHOW = 'https://open.spotify.com/show/4UjPh6TOoRFcVUATL9IiE1';
export const SPOTIFY_EPISODE = {};

// 先行公開した回（配信日より前に音声を出した回）：回番号 → stand.fm の回の住所。
// ここに足すと、その回は配信日前でも「配信後」と同じ表示になる（「聴く」＝この回を聴く（stand.fm）、「配信は○月○日から（予定）」の注記は出ない）。
// 次に先行公開する回が出たら { 1: '…', 2: 'https://stand.fm/episodes/…' } と足して、build-ep.mjs を回し直す（材料側には書かない）。
// Spotify の回の住所（SPOTIFY_EPISODE）が入っている回は、そちらを優先する。
export const STANDFM_EPISODE = {
  1: 'https://stand.fm/episodes/6b00055673b676464a0eb4e1', // 2026-11-20 先行公開
};

// 有料版の見本（/ep/1/text）。見本ページを作るのは第1回だけ。第2回以降の「有料版の見本」の札も、この第1回の見本を指す。
export const SITE = 'https://takken.mimiobo.com';
export const TEXT_SAMPLE_PATH = '/ep/1/text';
export const TEXT_SAMPLE_IMG = '/ep/1/text/a4-p1.webp';
export const ART_PATH = '/ep/1/img/artwork2027.webp';

// Umami（本番だけ。試し用のページには入れない）
// 2つ目は、来た入口（ent・mark）と表示の種類（view）をイベントに付ける共通の部品（ep/_shared/umami-ctx.js）。トラッカーのあとに読む
export const UMAMI_SCRIPT = '<script defer src="https://cloud.umami.is/script.js" data-website-id="99a5370c-5fbd-4ceb-9d35-7734d7c580ec"></script>\n<script defer src="/ep/_shared/umami-ctx.js"></script>\n';

// 第1回にしかない言い方（見本の回）。第2回以降は出さない
export const SAMPLE_EPS = [1];

// 登録なしの人にも、登録者と同じ続き（図の続き・今日のポイント・過去問1選）を全部開ける回。第1回だけ（第2回からは今までどおり、LINE・メールの登録で開く）。
// ここを増やす・外すだけで、その回のページの「全部開ける」が切り替わる（回の番号の決め打ちはここ1か所）。
export const OPEN_ALL_EPS = [1];

// 本編の回の数（回のページの下の固定バーで、最後の回の次を空きにする）
export const TOTAL_EPS = 41;

// 第1回は、手で作った版が本番に出ていて確認ずみ。見た目・動きを変えないため、第1回だけ昔のスマホ幅の手当て（CSS・図7の位置・図5の横スクロール箱）を使う。
// 第2回以降は、材料の _tools/sp_overrides.css と、図の幅の計算（plan_svgs と同じ）を使う。
export const LEGACY_EPS = [1];

// 「対象」の札（.target）の折り返しの区切り。第1回の前半だけ手で決めてある（それ以外は build が区切る）
export const TARGET_CHUNKS = {
  1: { 1: ['自ら売買・交換、', 'または他人の売買・交換・貸借の', '代理・媒介'] },
};

// YouTube講義を出す回。登録なしの見え方（図1枚＋○×）だけ、配信日より前に開ける（Kei 11/19）。図の続き・過去問1選・有料の部分は今までどおり配信日から。
// 第1回は閉じない回（SAMPLE_EPS）なので入れない。34〜36回は講義を出さないので入れない。
export const FREE_EARLY_EPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 37, 38, 39, 40, 41];
