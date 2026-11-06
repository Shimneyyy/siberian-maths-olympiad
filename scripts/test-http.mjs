import "dotenv/config";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
const port = 3100;
const base = `http://localhost:${port}`;
if (!process.env.BETTER_AUTH_SECRET) throw new Error("Configure BETTER_AUTH_SECRET before HTTP tests");
const env = { ...process.env, NODE_ENV: "development", DEMO_REGISTRATION: "true", BETTER_AUTH_URL: base, TEST_BASE_URL: base, NEXT_TELEMETRY_DISABLED: "1" };
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "ignore", "pipe"] });
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
  const run = spawn(process.execPath, ["--import", "tsx", "--test", "tests/auth-http.test.ts"], { env, stdio: "inherit" });
  process.exitCode = await new Promise((resolve) => { run.on("exit", (code) => resolve(code ?? 1)); run.on("error", () => resolve(1)); });
} finally {
  server.kill("SIGTERM");
}
