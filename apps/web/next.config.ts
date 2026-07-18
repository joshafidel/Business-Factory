import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  transpilePackages: [
    "@bf/agents",
    "@bf/analytics",
    "@bf/config",
    "@bf/database",
    "@bf/notifications",
    "@bf/prompts",
    "@bf/providers",
    "@bf/queue",
    "@bf/shared",
    "@bf/storage",
    "@bf/workflows",
  ],
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis", "pino"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
