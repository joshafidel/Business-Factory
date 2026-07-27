/**
 * Love Villa: Nations — the second installed business.
 *
 * The production pipeline itself is the standalone Remotion app in
 * apps/love-villa (episodes are generated + rendered locally, then uploaded
 * to TikTok by hand in the MVP). This module definition is what the platform
 * dashboard shows: the module row is registered from this single source of
 * truth by both the seed and the web app's lazy registration.
 */

export const LOVE_VILLA_KEY = "love-villa";

export const LOVE_VILLA_MODULE = {
  key: LOVE_VILLA_KEY,
  name: "Love Villa: Nations",
  description:
    "Serialized AI-animated TikTok dating-show comedy: eight exaggerated singles from around the world, one villa, zero chill.",
  manifest: {
    key: LOVE_VILLA_KEY,
    name: "Love Villa: Nations",
    description:
      "Serialized AI-animated TikTok dating-show comedy produced by the apps/love-villa Remotion pipeline.",
    workflows: [
      {
        key: "love-villa-episode",
        name: "Episode pipeline (local)",
        description:
          "generate-episode → produce-episode (assets + rough cut) → render-episode (final 1080x1920 MP4) → manual TikTok upload",
      },
    ],
    agents: [
      {
        key: "lv-writers-room",
        name: "Writers' Room",
        role: "writer",
        description:
          "Claude-written episode scripts with continuity memory (mock writers' room without keys)",
      },
      {
        key: "lv-continuity",
        name: "Continuity Supervisor",
        role: "reviewer",
        description:
          "Season-state continuity, brand-safety, and stereotype-risk checks on every script",
      },
    ],
    requiredIntegrations: ["tiktok", "image-gen", "voice-gen"],
    requiredPermissions: ["workflows:execute", "agents:execute"],
    dashboard: {
      navLabel: "Love Villa: Nations",
      widgets: [{ key: "summary", title: "Love Villa summary", kind: "stat" as const }],
    },
    metrics: [
      { key: "episodes_rendered", label: "Episodes rendered", unit: "count" as const },
      { key: "episodes_published", label: "Episodes on TikTok", unit: "count" as const },
    ],
    configSchema: { type: "object", properties: { enabled: { type: "boolean" } } },
  },
} as const;
