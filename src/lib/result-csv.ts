import { OlympiadError } from "./olympiad-rules";
export const RESULT_CSV_LIMIT = 524288;
export type ResultRow = { line: number; login: string; fullName: string | null; course: string | null; university: string | null; scores: (number | null)[]; total: number | null; prize: string | null; error: string | null };
const invalidIndividual = () => new OlympiadError("CONFLICT", "Неверная структура CSV. Нужны UTF-8 CSV, Логин, задачи по порядку и Сумма или Сумма баллов; ФИО, Курс, Вуз и Приз необязательны.");
// Bounded RFC-style CSV reader. Broken framing rejects the file: guessing record
// boundaries after an unmatched quote could attach a score to the wrong login.
export function parseResultCsv(source: string, subject: "individual" | "team" = "individual") {
  const invalid = subject === "individual" ? invalidIndividual : () => new OlympiadError("CONFLICT", "Нужны ID команды, необязательные Название команды/Курсы участников/Вуз, задачи по порядку, Сумма баллов и необязательный Приз.");
  const identity = subject === "team" ? "ID команды" : "Логин";
  const nameLabel = subject === "team" ? "Название команды" : "ФИО";
  const courseLabel = subject === "team" ? "Курсы участников" : "Курс";
  if (Buffer.byteLength(source, "utf8") > RESULT_CSV_LIMIT || source.includes("\uFFFD") || source.includes("\0")) throw invalid();
  const text = source.replace(/^\uFEFF/, "");
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], cell = "", quoted = false, closed = false, line = 1, start = 1;
  function field() { cells.push(cell); cell = ""; closed = false; if (cells.length > 56) throw invalid(); }
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
  if (!header || !records.length || new Set(header).size !== header.length) throw invalid();
  const hasPrize = header.at(-1) === "Приз";
  const totalIndex = header.length - (hasPrize ? 2 : 1);
  if (!["Сумма", "Сумма баллов"].includes(header[totalIndex])) throw invalid();
  const firstTask = header.indexOf("Задача 1");
  const taskCount = totalIndex - firstTask;
  if (firstTask < 1 || taskCount < 1 || taskCount > 50) throw invalid();
  const metadata = header.slice(0, firstTask);
  if (!metadata.includes(identity) || metadata.some(name => ![identity, nameLabel, courseLabel, "Вуз"].includes(name))) throw invalid();
  if (header.slice(firstTask, totalIndex).some((name, i) => name !== `Задача ${i + 1}`)) throw invalid();
  const loginIndex = header.indexOf(identity);
  const metadataValue = (cells: string[], name: string) => {
    const index = metadata.indexOf(name);
    return index < 0 ? null : cells[index]?.trim() || null;
  };
  const number = (s: string) => {
    const value = s.trim(); if (value === "") return null;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) throw new Error("INVALID_SCORE");
    return Number(value);
  };
  const rows: ResultRow[] = records.map(r => {
    const row: ResultRow = { line: r.line, login: r.cells[loginIndex]?.trim() ?? "", fullName: metadataValue(r.cells, nameLabel), course: metadataValue(r.cells, courseLabel), university: metadataValue(r.cells, "Вуз"), scores: [], total: null, prize: null, error: null };
    if (r.cells.length !== header.length) row.error = "COLUMN_COUNT";
    else if (!row.login || row.login.length > 254 || /[\u0000-\u001f\u007f]/.test(row.login)) row.error = "INVALID_LOGIN";
    else if (hasPrize && r.cells.at(-1)!.length > 200) row.error = "INVALID_PRIZE";
    else try { row.scores = r.cells.slice(firstTask, totalIndex).map(number); row.total = number(r.cells[totalIndex]); row.prize = hasPrize ? r.cells.at(-1)! || null : null; } catch { row.error = "INVALID_SCORE"; }
    return row;
  });
  return { taskCount, rows };
}
