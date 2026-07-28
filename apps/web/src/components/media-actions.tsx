"use client";

import * as React from "react";
import { Download, Share } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Download / save-to-camera-roll actions for a video (or any media file).
 *
 * - "Download": plain anchor to an attachment URL — works everywhere and
 *   saves to Files/Downloads.
 * - "Save to Photos": fetches the bytes and hands them to the native share
 *   sheet (Web Share API Level 2). On iPhone/Android that sheet includes
 *   "Save Video", which is the only web path into the camera roll. The
 *   button only renders on browsers that support sharing files.
 */
export function MediaActions({
  src,
  filename,
  variant = "buttons",
  className,
}: {
  /** Same-origin URL for the media bytes (streamed/inline version). */
  src: string;
  /** Filename to save as, e.g. "lion-video.mp4". */
  filename: string;
  variant?: "buttons" | "links";
  className?: string;
}) {
  const [canShareFiles, setCanShareFiles] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const mime = guessMime(filename);

  // Feature-detect after mount (avoids SSR/hydration mismatch).
  React.useEffect(() => {
    try {
      const probe = new File([""], filename, { type: mime });
      setCanShareFiles(
        typeof navigator !== "undefined" &&
          "canShare" in navigator &&
          navigator.canShare({ files: [probe] }),
      );
    } catch {
      setCanShareFiles(false);
    }
  }, [filename, mime]);

  const downloadHref = withDownloadParam(src);

  const share = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: mime });
      await navigator.share({ files: [file] });
      setNote("Opened the share sheet — pick “Save Video” to add it to your camera roll.");
    } catch (err) {
      // AbortError = user dismissed the sheet; not an error worth showing.
      if ((err as Error).name !== "AbortError") {
        setNote("Couldn’t open the share sheet — use Download instead.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (variant === "links") {
    return (
      <span className={cn("inline-flex flex-wrap items-center gap-3 text-xs", className)}>
        <a
          href={downloadHref}
          download={filename}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </a>
        {canShareFiles ? (
          <button
            type="button"
            onClick={share}
            disabled={busy}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline disabled:opacity-50"
          >
            <Share className="h-3.5 w-3.5" /> {busy ? "Preparing…" : "Save to Photos"}
          </button>
        ) : null}
        {note ? <span className="text-muted-foreground">{note}</span> : null}
      </span>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap gap-2">
        <a
          href={downloadHref}
          download={filename}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
        >
          <Download className="h-4 w-4" /> Download
        </a>
        {canShareFiles ? (
          <button
            type="button"
            onClick={share}
            disabled={busy}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Share className="h-4 w-4" /> {busy ? "Preparing…" : "Save to Photos"}
          </button>
        ) : null}
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** Append download=1 to asset-API URLs so the server sends an attachment. */
function withDownloadParam(src: string): string {
  if (!src.startsWith("/api/assets/raw")) return src;
  return `${src}${src.includes("?") ? "&" : "?"}download=1`;
}

function guessMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}
