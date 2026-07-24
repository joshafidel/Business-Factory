import { PrismaPlugin } from "@prisma/nextjs-monorepo-workaround-plugin";
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
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis", "pino", "ffmpeg-static"],
  // Prisma in a pnpm monorepo on Vercel: make sure the query engine binary
  // reaches the serverless bundle (belt: official plugin copies engines;
  // braces: force-trace the generated client directory).
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.plugins.push(new PrismaPlugin());
    }
    return config;
  },
  outputFileTracingIncludes: {
    "/**/*": [
      "../../packages/database/src/generated/client/**",
      "../../node_modules/.pnpm/ffmpeg-static@*/**",
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
