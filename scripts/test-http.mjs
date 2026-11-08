import "dotenv/config";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { setTimeout } from "node:timers/promises";
const target = process.argv[2] || "tests/auth-http.test.ts";
if (!["tests/auth-http.test.ts", "tests/live.test.ts", "tests/communications-http.test.ts"].includes(target)) throw new Error("Unknown HTTP test target");
const port = 3100;
const base = `http://localhost:${port}`;
if (!process.env.BETTER_AUTH_SECRET) throw new Error("Configure BETTER_AUTH_SECRET before HTTP tests");
const env = { ...process.env, NODE_ENV: "development", DEMO_REGISTRATION: "true", BETTER_AUTH_URL: base, TEST_BASE_URL: base, NEXT_TELEMETRY_DISABLED: "1", SMO_TEST_DIST_DIR: ".next/test-runtime" };
// Communications exercise immutable publications. Use a disposable local database,
// then drop that database rather than bypassing publication protection to clean up.
let control, disposable;
if (target === "tests/communications-http.test.ts") {
  const url = new URL(env.DATABASE_URL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Local synthetic database required");
  disposable = `smo_test_${randomUUID().replaceAll("-", "")}`;
  control = new Client({ connectionString: env.DATABASE_URL }); await control.connect();
  await control.query(`CREATE DATABASE "${disposable}"`);
  url.pathname = `/${disposable}`; env.DATABASE_URL = url.toString();
  for (const script of ["db:migrate", "db:seed"]) {
    const task = spawn("npm", ["run", script], { env, stdio: "ignore" });
    if (await new Promise(resolve => { task.on("exit", resolve); task.on("error", () => resolve(1)); }) !== 0) {
      await control.query(`DROP DATABASE "${disposable}" WITH (FORCE)`); await control.end();
      throw new Error("Disposable database setup failed");
    }
  }
}
await rm(env.SMO_TEST_DIST_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", process.env.TEST_SERVER_LOG ? "pipe" : "ignore", "pipe"] });
if (process.env.TEST_SERVER_LOG) {
  const log = createWriteStream(process.env.TEST_SERVER_LOG);
  server.stdout?.pipe(log); server.stderr.pipe(log);
}
server.stderr.on("data", () => { /* No server logs containing request URLs in test output. */ });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error("HTTP test server exited before readiness");
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) { ready = true; break; }
    } catch { /* Startup is asynchronous. */ }
    await setTimeout(500);
  }
  if (!ready) throw new Error("HTTP test server/database failed readiness");
  const run = spawn(process.execPath, ["--import", "tsx", "--test", target], { env, stdio: "inherit" });
  process.exitCode = await new Promise((resolve) => { run.on("exit", (code) => resolve(code ?? 1)); run.on("error", () => resolve(1)); });
} finally {
  server.kill("SIGTERM");
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.on("exit", resolve); });
  await rm(env.SMO_TEST_DIST_DIR, { recursive: true, force: true });
  if (control) {
    await control.query(`DROP DATABASE "${disposable}" WITH (FORCE)`); await control.end();
  }
}
