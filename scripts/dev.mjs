import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import nextEnv from "@next/env";

const require = createRequire(import.meta.url);
const { combinedEnv } = nextEnv.loadEnvConfig(process.cwd(), true);
const env = { ...combinedEnv, NODE_ENV: "development" };
const children = new Set();
let stopping = false;

function stop() {
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}

function start(args) {
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  children.add(child);
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  child.once("exit", (code) => {
    children.delete(child);
    if (stopping) return;
    process.exitCode = code ?? 1;
    stop();
  });
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
start([require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)]);
if (env.DEMO_REGISTRATION === "true") start(["--import", "tsx", "scripts/mail-worker.ts"]);
