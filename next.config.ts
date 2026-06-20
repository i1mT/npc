import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
