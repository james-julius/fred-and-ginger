import type { NextConfig } from "next";

// James's Worker (cloud/) serves the data API and login. Locally, set
// FRED_API_URL=http://localhost:8787 in .env.local to use `wrangler dev` instead.
const API = process.env.FRED_API_URL ?? "https://fredandginger.jamesjuliusdarby.com";

const nextConfig: NextConfig = {
  // Keep Next's dev-only button off the sidebar's account row.
  devIndicators: { position: "bottom-right" },
  // Serve images as-is. Resizing on Cloudflare needs an Images binding we haven't set up.
  images: { unoptimized: true },
  // Routes in app/ win over these, so a future app/api/chat/route.ts is served here, not by the Worker.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/login", destination: `${API}/login` },
      { source: "/logout", destination: `${API}/logout` },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
