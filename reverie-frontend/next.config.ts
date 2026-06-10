import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['lvh.me', '*.lvh.me', '*.app.lvh.me'],
  serverExternalPackages: ['pyodide'],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
