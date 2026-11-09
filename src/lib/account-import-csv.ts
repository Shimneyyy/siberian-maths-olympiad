import { z } from "zod";
import { legacyNsuhwLogin } from "./legacy-nsuhw-rules";
import { OlympiadError } from "./olympiad-rules";
export const ACCOUNT_CSV_LIMIT = 524288;
const invalid = () => new OlympiadError("CONFLICT", "Неверный CSV: UTF-8, запятая, заголовки ID пользователя ЛК,логин nsuhw,пароль nsuhw; до 1000 строк и 512 КиБ.");
export function parseAccountCsv(source: string) {
  if (Buffer.byteLength(source, "utf8") > ACCOUNT_CSV_LIMIT || /[\uFFFD\0]/.test(source)) throw invalid();
  const text = source.replace(/^\uFEFF/, ""), records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], cell = "", quoted = false, closed = false, line = 1, start = 1;
  function field() { cells.push(cell); cell = ""; closed = false; if (cells.length > 4) throw invalid(); }
  function record() { field(); records.push({ line: start, cells }); cells = []; if (records.length > 1001) throw invalid(); }
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
  if (JSON.stringify(records.shift()?.cells) !== JSON.stringify(["ID пользователя ЛК", "логин nsuhw", "пароль nsuhw"]) || !records.length) throw invalid();
  return records.map(r => {
    const userId = r.cells[0]?.trim() ?? "", login = r.cells[1]?.trim() ?? "", password = r.cells[2] ?? "";
    const error = r.cells.length !== 3 ? "COLUMN_COUNT" : !z.uuid().safeParse(userId).success ? "INVALID_USER_ID" : !legacyNsuhwLogin.safeParse(login).success ? "INVALID_LOGIN" : !password || password.length > 128 || /[\u0000-\u001f\u007f]/.test(password) ? "INVALID_PASSWORD" : null;
    return { line: r.line, userId, login, password, error };
  });
}
