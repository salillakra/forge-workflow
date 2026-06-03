import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forward /api/* to the Go backend in dev (optional — the axios client uses the env var directly)
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
