import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["kiteconnect"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
