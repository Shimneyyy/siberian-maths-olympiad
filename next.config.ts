import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
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
