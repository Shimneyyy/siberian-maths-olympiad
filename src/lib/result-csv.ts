import { OlympiadError } from "./olympiad-rules";
export const RESULT_CSV_LIMIT = 524288;
export type ResultRow = { line: number; login: string; scores: (number | null)[]; total: number | null; prize: string | null; error: string | null };
const invalid = () => new OlympiadError("CONFLICT", "Неверная структура CSV. Нужны UTF-8, запятая и заголовки Логин,Задача 1,…,Сумма,Приз.");
// Bounded RFC-style CSV reader. Broken framing rejects the file: guessing record
// boundaries after an unmatched quote could attach a score to the wrong login.
export function parseResultCsv(source: string) {
  if (Buffer.byteLength(source, "utf8") > RESULT_CSV_LIMIT || source.includes("\uFFFD") || source.includes("\0")) throw invalid();
  const text = source.replace(/^\uFEFF/, "");
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], cell = "", quoted = false, closed = false, line = 1, start = 1;
  function field() { cells.push(cell); cell = ""; closed = false; if (cells.length > 53) throw invalid(); }
  function record() { field(); records.push({ line: start, cells }); cells = []; if (records.length > 10001) throw invalid(); }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else { cell += c; if (c === "\r" || (c === "\n" && text[i - 1] !== "\r")) line++; }
    } else if (c === ",") field();
    else if (c === "\r" || c === "\n") { if (c === "\r" && text[i + 1] === "\n") i++; record(); line++; start = line; }
    else if (c === '"' && cell === "" && !closed) quoted = true;
    else { if (closed || c === '"') throw invalid(); cell += c; }
    if (cell.length > 1024) throw invalid();
  }
  if (quoted) throw invalid();
  if (cell || cells.length || closed) record();
  const header = records.shift()?.cells;
  if (!header || header.length < 4 || header.length > 53 || header[0] !== "Логин" || header.at(-2) !== "Сумма" || header.at(-1) !== "Приз") throw invalid();
  const taskCount = header.length - 3;
  if (header.slice(1, -2).some((v, i) => v !== `Задача ${i + 1}`) || !records.length) throw invalid();
  const number = (s: string) => {
    const value = s.trim(); if (value === "") return null;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) throw new Error("INVALID_SCORE");
    return Number(value);
  };
  const rows: ResultRow[] = records.map(r => {
    const row: ResultRow = { line: r.line, login: r.cells[0]?.trim() ?? "", scores: [], total: null, prize: null, error: null };
    if (r.cells.length !== header.length) row.error = "COLUMN_COUNT";
    else if (!row.login || row.login.length > 254 || /[\u0000-\u001f\u007f]/.test(row.login)) row.error = "INVALID_LOGIN";
    else if (r.cells.at(-1)!.length > 200) row.error = "INVALID_PRIZE";
    else try { row.scores = r.cells.slice(1, -2).map(number); row.total = number(r.cells.at(-2)!); row.prize = r.cells.at(-1)! || null; } catch { row.error = "INVALID_SCORE"; }
    return row;
  });
  return { taskCount, rows };
}
