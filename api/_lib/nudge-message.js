// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
// 運営者への知らせの文。文面を変えるときはここだけ直す。people: [{name, lastAt(ms), listened}]。日付は日本時間。
const md = ms => { const d = new Date(ms + 9 * 3600000); return (d.getUTCMonth() + 1) + '/' + (d.getUTCDate()); };
function buildNotice(people) {
  const lines = people.map(p => `・${p.name}さん（最後の記録 ${md(p.lastAt)}・聴いた回 ${p.listened}）`);
  return `記録が3週間以上あいた方が ${people.length}人います。\n\n${lines.join('\n')}\n\n声をかけますか。`;
}
module.exports = { buildNotice };
