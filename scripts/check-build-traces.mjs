import "dotenv/config";
import { glob, readFile } from "node:fs/promises";
import { resolve, dirname, relative, sep } from "node:path";
const root = process.cwd();
const keyring = resolve(process.env.NSUHW_KEYRING_FILE || ".local/nsuhw-keyring.json");
let count = 0;
for await (const file of glob(`${process.env.SMO_TEST_DIST_DIR || ".next"}/server/**/*.nft.json`)) {
  count++;
  const trace = JSON.parse(await readFile(file, "utf8"));
  for (const path of trace.files) {
    const target = resolve(dirname(file), path), local = relative(root, target);
    if (target === keyring || local.startsWith(`.local${sep}`) || local === ".env" || /^\.env\./.test(local)) {
      // Never include file contents or configured secret paths in errors.
      throw new Error("Local secrets included in build trace; do not distribute this build");
    }
  }
}
if (!count) throw new Error("No server build traces found; run npm run build first");
console.log(`Checked ${count} server traces: local secrets excluded`);
