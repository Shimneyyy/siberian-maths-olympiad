import { spawn } from "node:child_process";
// Runs fixed PostgreSQL tooling inside the already configured local/CI container.
// Never prints dump contents, stderr, command credentials or environment values.
export async function pgTool(command: "pg_dump" | "pg_restore", database: string, input?: Buffer) {
  if (!/^[a-z0-9_]+$/.test(database)) throw new Error("Invalid synthetic database name");
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^[a-zA-Z0-9_]+$/.test(url.username)) throw new Error("Local PostgreSQL required");
  const prefix = process.env.PG_CONTAINER ? ["exec", "-i", process.env.PG_CONTAINER] : ["compose", "exec", "-T", "postgres"];
  const args = command === "pg_dump" ? [command, "-U", url.username, "-d", database, "--format=custom", "--no-owner", "--no-acl"] : [command, "-U", url.username, "-d", database, "--no-owner", "--no-acl", "--exit-on-error"];
  return new Promise<Buffer>((resolve, reject) => {
    const task = spawn("docker", [...prefix, ...args], { stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = []; let size = 0, failed = false;
    const fail = () => { failed = true; task.kill("SIGTERM"); reject(new Error("Local PostgreSQL backup tool failed")); };
    const timer = setTimeout(fail, 60000);
    task.on("error", fail); task.stdin.on("error", fail);
    task.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 64 * 1024 * 1024) fail(); else chunks.push(chunk); });
    task.on("close", code => { clearTimeout(timer); if (failed) return; if (code !== 0) reject(new Error("Local PostgreSQL backup tool failed")); else resolve(Buffer.concat(chunks)); });
    task.stdin.end(input);
  });
}
