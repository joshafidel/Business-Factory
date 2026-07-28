import type { MetadataRoute } from "next";

/** PWA manifest — lets "Add to Home Screen" install the dashboard like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Business Factory",
    short_name: "Factory",
    description: "Your AI business dashboard — videos, approvals, and earnings.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7fb",
    theme_color: "#7c3aed",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
