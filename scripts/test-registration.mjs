import { spawn } from "node:child_process";
for (const scenario of ["keyring", "mail"]) {
  const child = spawn(process.execPath, ["scripts/test-http.mjs", "tests/registration-http.test.ts"], { env: { ...process.env, TEST_REGISTRATION_FAILURE: scenario }, stdio: "inherit" });
  const code = await new Promise(resolve => { child.on("exit", resolve); child.on("error", () => resolve(1)); });
  if (code !== 0) { process.exitCode = code || 1; break; }
}
