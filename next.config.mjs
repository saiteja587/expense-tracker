import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Browser tests only (npm run e2e): swap Neon for an in-memory Postgres
  // (PGlite) so the real app runs with no database server. Never set in
  // production.
  webpack(config, { isServer }) {
    if (process.env.E2E_PGLITE === "1" && isServer) {
      config.resolve.alias["@neondatabase/serverless"] = path.resolve("tests/e2e/neonShim.mjs");
      // Next treats the Neon driver as external; bundle it (i.e. the shim) instead.
      const NEON = "@neondatabase/serverless";
      config.externals = [
        ...(config.externals || []).map((ext) => (typeof ext !== "function" ? ext
          : (data, cb) => (data.request === NEON ? (cb ? cb() : Promise.resolve()) : ext(data, cb)))),
        "@electric-sql/pglite",
      ];
    }
    return config;
  },
};

export default nextConfig;
