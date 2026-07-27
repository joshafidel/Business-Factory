import type { MetadataRoute } from "next";

/** PWA manifest — lets "Add to Home Screen" install the dashboard like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Business Factory",
    short_name: "Factory",
    description: "Your AI business dashboard — videos, approvals, and earnings.",
    start_url: "/",
    display: "standalone",
    background_color: "#fdf6f0",
    theme_color: "#f9a8d4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
