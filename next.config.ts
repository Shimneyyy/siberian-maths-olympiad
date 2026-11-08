import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: { "/api/diplomas/upload": ["./scripts/check-passive-pdf.mjs", "./node_modules/pdf-lib/**/*", "./node_modules/@pdf-lib/**/*", "./node_modules/pako/**/*", "./node_modules/tslib/**/*"] },
  // Runtime secrets must never be copied into a distributable server bundle.
  outputFileTracingExcludes: { "/*": ["./.local/**/*", "./.env", "./.env.*"] },
  // Each HTTP runner owns its generated outputs; never reuse a production/dev cache.
  distDir: process.env.SMO_TEST_DIST_DIR || ".next",
  // Reset links contain single-use tokens: never log URLs/arguments in development.
  logging: { incomingRequests: false, serverFunctions: false, browserToTerminal: false },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
};
export default config;
