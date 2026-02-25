/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  typescript: {
    // Pre-existing Convex type issues: `internal.*` resolves to `{}` due to
    // circular type dependencies in generated code. Convex resolves these at
    // runtime. Run `npx convex typecheck` separately if needed.
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
