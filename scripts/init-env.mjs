import { readFile, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
const path = ".env";
let source;
try { await access(path); source = await readFile(path, "utf8"); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  source = await readFile(".env.example", "utf8");
}
if (!parse(source).BETTER_AUTH_SECRET) {
  const line = `BETTER_AUTH_SECRET="${randomBytes(32).toString("hex")}"`;
  source = /^BETTER_AUTH_SECRET=.*$/m.test(source) ? source.replace(/^BETTER_AUTH_SECRET=.*$/m, line) : `${source}\n${line}\n`;
}
await writeFile(path, source, { mode: 0o600 });
console.log("Local .env prepared; existing settings and nonempty secret preserved. Synthetic signup requires DEMO_REGISTRATION=true.");
