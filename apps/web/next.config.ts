import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  transpilePackages: ["@flowproof/core", "@flowproof/ai", "@flowproof/database"],
  serverExternalPackages: ["@prisma/client", "prisma"],
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.trycloudflare.com"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
