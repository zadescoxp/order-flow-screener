import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // Siebly exchange SDKs import Node's `https` for their REST client and
    // `crypto` for signing private requests; neither runs for public data.
    resolveAlias: {
      https: { browser: "./lib/shims/https.browser.js" },
      crypto: { browser: "./lib/shims/crypto.browser.js" },
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
