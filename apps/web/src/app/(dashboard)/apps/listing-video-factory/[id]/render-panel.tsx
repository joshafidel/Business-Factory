"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  VIDEO_FORMATS,
  type ListingOptions,
  type ListingProperty,
  type ListingScript,
  type SocialPackage,
} from "@bf/workflows/src/listing-factory/types";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { MediaActions } from "@/components/media-actions";
import { generateSocialAction, startRenderAction } from "../actions";
import { rasterizeOverlays } from "./overlay-rasterizer";

interface RenderRow {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  videoAssetId: string | null;
  createdAtLabel: string;
  srtAssetId: string | null;
  reportAssetId: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued…",
  prepare: "Generating voice-over & motion…",
  branch: "Generating motion…",
  wait: "Animating scenes…",
  assemble: "Rendering video…",
  notify: "Finishing up…",
};

/**
 * The listing card: the rendered walkthrough front and center, with the
 * address, the listing link, and the realtor's contact info beside it.
 */
export function RenderPanel(props: {
  projectId: string;
  canExecute: boolean;
  rightsConfirmed: boolean;
  hasScript: boolean;
  format: "vertical" | "landscape" | "square";
  options: ListingOptions;
  property: ListingProperty;
  script: ListingScript | null;
  photos: { id: string; assetId: string }[];
  estimateMicroUsd: string;
  socialPackage: SocialPackage | null;
  renders: RenderRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRender = props.renders.find((r) => r.status === "QUEUED" || r.status === "RUNNING");
  const latestVideo = props.renders.find((r) => r.status === "COMPLETED" && r.videoAssetId);
  const olderRenders = props.renders.filter((r) => r.id !== latestVideo?.id && r.id !== activeRender?.id);

  useEffect(() => {
    if (!activeRender) return;
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/listing-factory/renders/${activeRender.id}`);
          if (!res.ok) return;
          const body = (await res.json()) as { status: string; stage: string };
          setStage(STAGE_LABELS[body.stage] ?? body.stage);
          if (body.status === "COMPLETED" || body.status === "FAILED") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStage(null);
            router.refresh();
          }
        } catch {
          // transient poll failure — keep trying
        }
      })();
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeRender?.id, activeRender, router]);

  const startRender = (kind: "preview" | "final"): void => {
    if (!props.script) return;
    setError(null);
    setBusy(kind);
    void (async () => {
      try {
        const dims = VIDEO_FORMATS[props.format];
        const rastered = await rasterizeOverlays({
          width: dims.width,
          height: dims.height,
          script: props.script!,
          property: props.property,
          options: props.options,
          isPreview: kind === "preview",
        });
        const overlays: { assetId: string; role: string; sceneIndex?: number }[] = [];
        for (const ov of rastered) {
          const form = new FormData();
          form.append("kind", "overlay");
          form.append("role", ov.role);
          form.append("files", ov.blob, `${ov.role}.png`);
          const res = await fetch(`/api/listing-factory/projects/${props.projectId}/photos`, {
            method: "POST",
            body: form,
          });
          const body = (await res.json()) as { assetId?: string; error?: string };
          if (!res.ok || !body.assetId) throw new Error(body.error ?? "Overlay upload failed");
          overlays.push({ assetId: body.assetId, role: ov.role, sceneIndex: ov.sceneIndex });
        }
        startTransition(async () => {
          const res = await startRenderAction(props.projectId, { kind, overlays });
          if (res.error) setError(res.error);
          setBusy(null);
          router.refresh();
        });
      } catch (err) {
        setError((err as Error).message);
        setBusy(null);
      }
    })();
  };

  const estimate = Number(props.estimateMicroUsd) / 1_000_000;
  const blocking = !props.rightsConfirmed || !props.hasScript || props.photos.length === 0;
  const p = props.property;
  const contact = [p.agentPhone, p.agentEmail].filter(Boolean).join(" · ");

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-col gap-5 md:flex-row">
          {/* The walkthrough video */}
          <div className="md:w-[300px] md:shrink-0">
            {latestVideo?.videoAssetId ? (
              <video
                key={latestVideo.videoAssetId}
                src={`/api/assets/raw?id=${latestVideo.videoAssetId}`}
                controls
                playsInline
                preload="metadata"
                className={`w-full rounded-lg bg-black ${props.format === "landscape" ? "" : "max-h-[520px]"}`}
              />
            ) : (
              <div className="flex aspect-[9/16] max-h-[420px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-center text-sm text-muted-foreground">
                <span className="text-3xl">🎬</span>
                {activeRender ? (stage ?? "Rendering…") : "No video yet"}
              </div>
            )}
          </div>

          {/* Address, listing link, realtor, render controls */}
          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <h2 className="text-lg font-semibold leading-snug">{p.address}</h2>
              {p.listingUrl ? (
                <a
                  href={p.listingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View listing ↗
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No listing link yet — paste it in Listing details below.
                </p>
              )}
            </div>

            {p.agentName || p.brokerage || contact ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Realtor
                </p>
                {p.agentName ? <p className="font-medium">{p.agentName}</p> : null}
                {p.brokerage ? <p className="text-muted-foreground">{p.brokerage}</p> : null}
                {contact ? <p className="text-muted-foreground">{contact}</p> : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No realtor on file — add contact info in Listing details below.
              </p>
            )}

            {props.canExecute ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={Boolean(busy) || pending || blocking || Boolean(activeRender)}
                    onClick={() => startRender("preview")}
                  >
                    {busy === "preview" ? "Starting…" : "Render preview"}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={Boolean(busy) || pending || blocking || Boolean(activeRender)}
                    onClick={() => startRender("final")}
                  >
                    {busy === "final" ? "Starting…" : "Render walkthrough"}
                  </Button>
                </div>
                {activeRender ? (
                  <p className="text-xs text-primary">
                    ⏳ {stage ?? "Rendering…"} — takes a few minutes; you can leave this page.
                  </p>
                ) : null}
                {blocking ? (
                  <p className="text-xs text-warning">
                    To render:{" "}
                    {[
                      props.photos.length === 0 && "add photos",
                      !props.hasScript && "generate the narration",
                      !props.rightsConfirmed && "confirm usage rights (Listing details)",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {estimate > 0
                      ? `≈ $${estimate.toFixed(2)} per final render (AI walkthrough motion + voice). Previews are free.`
                      : "No paid APIs needed for this render."}
                  </p>
                )}
                {error ? <p className="text-xs text-destructive">{error}</p> : null}
              </div>
            ) : null}

            {latestVideo ? (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <MediaActions
                  variant="links"
                  src={`/api/assets/raw?id=${latestVideo.videoAssetId}`}
                  filename="listing-walkthrough.mp4"
                />
                {latestVideo.srtAssetId ? (
                  <a
                    href={`/api/assets/raw?id=${latestVideo.srtAssetId}`}
                    download
                    className="text-muted-foreground hover:underline"
                  >
                    Captions (.srt)
                  </a>
                ) : null}
                {latestVideo.reportAssetId ? (
                  <a
                    href={`/api/assets/raw?id=${latestVideo.reportAssetId}`}
                    download
                    className="text-muted-foreground hover:underline"
                  >
                    Report
                  </a>
                ) : null}
                <span className="text-muted-foreground">
                  {latestVideo.kind === "FINAL" ? "Final" : "Preview"} · {latestVideo.createdAtLabel}
                </span>
              </div>
            ) : null}
            {activeRender?.error ? (
              <p className="text-xs text-destructive">{activeRender.error}</p>
            ) : null}

            <SocialSection
              projectId={props.projectId}
              canExecute={props.canExecute}
              hasScript={props.hasScript}
              socialPackage={props.socialPackage}
            />

            {olderRenders.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Previous renders ({olderRenders.length})
                </summary>
                <div className="mt-2 space-y-1.5">
                  {olderRenders.map((render) => (
                    <div
                      key={render.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
                    >
                      <span>
                        {render.kind === "FINAL" ? "Final" : "Preview"} · {render.createdAtLabel}
                      </span>
                      <span className="flex items-center gap-2">
                        {render.status === "COMPLETED" && render.videoAssetId ? (
                          <a
                            href={`/api/assets/raw?id=${render.videoAssetId}&download=1`}
                            download
                            className="text-primary hover:underline"
                          >
                            Download
                          </a>
                        ) : null}
                        <Badge
                          variant={
                            render.status === "COMPLETED"
                              ? "success"
                              : render.status === "FAILED"
                                ? "destructive"
                                : "warning"
                          }
                        >
                          {render.status.toLowerCase()}
                        </Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SocialSection({
  projectId,
  canExecute,
  hasScript,
  socialPackage,
}: {
  projectId: string;
  canExecute: boolean;
  hasScript: boolean;
  socialPackage: SocialPackage | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (label: string, text: string): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const rows: { label: string; text: string }[] = socialPackage
    ? [
        { label: "TikTok caption", text: socialPackage.tiktokCaption },
        { label: "Instagram caption", text: socialPackage.instagramCaption },
        { label: "YouTube title", text: socialPackage.youtubeTitle },
        { label: "YouTube description", text: socialPackage.youtubeDescription },
        { label: "Hashtags", text: (socialPackage.hashtags ?? []).join(" ") },
        { label: "Cover text", text: socialPackage.coverText },
      ].filter((r) => r.text)
    : [];

  return (
    <details className="text-xs" open={rows.length > 0}>
      <summary className="cursor-pointer font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        Social captions
      </summary>
      <div className="mt-2 space-y-1.5">
        {canExecute ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !hasScript}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await generateSocialAction(projectId);
                if (res.error) setError(res.error);
                router.refresh();
              });
            }}
          >
            {pending ? "Writing…" : socialPackage ? "Regenerate captions" : "Generate captions"}
          </Button>
        ) : null}
        {error ? <p className="text-destructive">{error}</p> : null}
        {rows.map((row) => (
          <div key={row.label} className="rounded-md bg-muted/40 p-2">
            <div className="mb-0.5 flex items-center justify-between">
              <span className="font-medium">{row.label}</span>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => copy(row.label, row.text)}
              >
                {copied === row.label ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="whitespace-pre-wrap text-muted-foreground">{row.text}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
