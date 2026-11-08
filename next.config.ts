import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
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
