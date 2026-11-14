// 第1回だけを、回のページの build（build-ep.mjs）に通す入口。使い方：node scripts/build-ep1-text.mjs
// 第1回の本番の出力（ep/1/ の各ファイル・ep/_shared/・api/_ep-text/）の注記が、この名前で残っているので、入口として残してある。
// 中身は build-ep.mjs（全回共通）。回の番号を渡して作る：node scripts/build-ep.mjs 2 ／ 1-9 ／ all
import { main } from './build-ep.mjs';
main(['1']);
