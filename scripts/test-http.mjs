import "dotenv/config";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { setTimeout } from "node:timers/promises";
const target = process.argv[2] || "tests/auth-http.test.ts";
if (!["tests/auth-http.test.ts", "tests/live.test.ts", "tests/communications-http.test.ts", "tests/load-http.test.ts"].includes(target)) throw new Error("Unknown HTTP test target");
const productionLoad = target === "tests/load-http.test.ts";
const port = 3100;
const base = `http://localhost:${port}`;
if (!process.env.BETTER_AUTH_SECRET) throw new Error("Configure BETTER_AUTH_SECRET before HTTP tests");
const env = { ...process.env, NODE_ENV: "development", DEMO_REGISTRATION: "true", BETTER_AUTH_URL: base, TEST_BASE_URL: base, NEXT_TELEMETRY_DISABLED: "1", SMO_TEST_DIST_DIR: ".next/test-runtime" };
// Communications exercise immutable publications. Use a disposable local database,
// then drop that database rather than bypassing publication protection to clean up.
let control, disposable, diplomaDirectory;
if (["tests/communications-http.test.ts", "tests/load-http.test.ts"].includes(target)) {
  const url = new URL(env.DATABASE_URL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Local synthetic database required");
  disposable = `smo_test_${randomUUID().replaceAll("-", "")}`;
  diplomaDirectory = `.local/test-diplomas-${randomUUID().replaceAll("-", "")}`;
  env.DIPLOMA_DIRECTORY = diplomaDirectory;
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
// Measure the optimized runtime, not the development compiler/HMR. Build into
// this runner's private distDir and verify traces before starting local production.
if (productionLoad) {
  env.SMO_SYNTHETIC_DIAGNOSTICS = "true";
  env.NODE_ENV = "production"; // Synthetic fixtures were prepared before starting the optimized runtime.
  for (const args of [["node_modules/next/dist/bin/next", "build"], ["scripts/check-build-traces.mjs"]]) {
    const build = spawn(process.execPath, args, { env, stdio: "ignore" });
    const code = await new Promise(resolve => { build.on("exit", resolve); build.on("error", () => resolve(1)); });
    if (code !== 0) {
      await rm(env.SMO_TEST_DIST_DIR, { recursive: true, force: true });
      if (control) { await control.query(`DROP DATABASE "${disposable}" WITH (FORCE)`); await control.end(); }
      if (diplomaDirectory) await rm(diplomaDirectory, { recursive: true, force: true });
      throw new Error("Isolated load build/trace verification failed");
    }
  }
}
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", productionLoad ? "start" : "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", process.env.TEST_SERVER_LOG ? "pipe" : "ignore", "pipe"] });
if (process.env.TEST_SERVER_LOG) {
  const log = createWriteStream(process.env.TEST_SERVER_LOG);
  server.stdout?.pipe(log); server.stderr.pipe(log);
}
server.stderr.on("data", chunk => {
  // Only a fixed synthetic diagnostic marker may reach test logs; never forward server stderr.
  if (productionLoad) for (const code of String(chunk).match(/SYNTHETIC_API_FAILURE:(?:P\d{4}|UNCLASSIFIED)/g) || []) console.error(code);
});
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
  if (diplomaDirectory) await rm(diplomaDirectory, { recursive: true, force: true });
}
