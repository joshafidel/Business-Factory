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
  prepare: "Generating voice-over…",
  assemble: "Rendering video…",
  notify: "Finishing up…",
};

export function RenderPanel(props: {
  projectId: string;
  canExecute: boolean;
  rightsConfirmed: boolean;
  hasScript: boolean;
  format: "vertical" | "landscape" | "square";
  style: string;
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

  // Poll while a render is active; refresh the page data when it settles.
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
  const warningsBlocking = !props.rightsConfirmed || !props.hasScript || props.photos.length === 0;

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="mb-3 text-sm font-semibold">5 · Render & downloads</h2>

        {props.canExecute ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={Boolean(busy) || pending || warningsBlocking || Boolean(activeRender)}
                onClick={() => startRender("preview")}
              >
                {busy === "preview" ? "Starting…" : "Render preview"}
              </Button>
              <Button
                size="sm"
                className="flex-1"
                disabled={Boolean(busy) || pending || warningsBlocking || Boolean(activeRender)}
                onClick={() => startRender("final")}
              >
                {busy === "final" ? "Starting…" : "Render final video"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Preview is fast, half-resolution, and watermarked. Final renders{" "}
              {VIDEO_FORMATS[props.format].width}×{VIDEO_FORMATS[props.format].height}.{" "}
              {estimate > 0
                ? `Estimated final-render cost ≈ $${estimate.toFixed(2)} (AI walkthrough motion + voice; previews are free, re-used voice lines are free).`
                : "No paid APIs needed for this render."}
            </p>
            {warningsBlocking ? (
              <p className="text-xs text-warning">
                To render:{" "}
                {[
                  props.photos.length === 0 && "upload photos",
                  !props.hasScript && "generate the script",
                  !props.rightsConfirmed && "confirm usage rights (section 2)",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {activeRender ? (
              <p className="text-xs text-primary">
                ⏳ {stage ?? "Rendering…"} — you can leave this page; it keeps going.
              </p>
            ) : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        ) : null}

        {props.renders.length > 0 ? (
          <div className="mt-4 space-y-2">
            {props.renders.map((render) => (
              <div key={render.id} className="rounded-md border border-border p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {render.kind === "FINAL" ? "Final" : "Preview"} · {render.createdAtLabel}
                  </span>
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
                </div>
                {render.error ? <p className="mt-1 text-destructive">{render.error}</p> : null}
                {render.status === "COMPLETED" && render.videoAssetId ? (
                  <div className="mt-2 space-y-2">
                    <video
                      src={`/api/assets/raw?id=${render.videoAssetId}`}
                      controls
                      preload="metadata"
                      className="max-h-72 w-full rounded-md bg-black"
                    />
                    <div className="flex flex-wrap gap-3">
                      <a
                        href={`/api/assets/raw?id=${render.videoAssetId}`}
                        download
                        className="font-medium text-primary hover:underline"
                      >
                        ⬇ Download MP4
                      </a>
                      {render.srtAssetId ? (
                        <a
                          href={`/api/assets/raw?id=${render.srtAssetId}`}
                          download
                          className="text-muted-foreground hover:underline"
                        >
                          Captions (.srt)
                        </a>
                      ) : null}
                      {render.reportAssetId ? (
                        <a
                          href={`/api/assets/raw?id=${render.reportAssetId}`}
                          download
                          className="text-muted-foreground hover:underline"
                        >
                          Generation report
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <SocialSection
          projectId={props.projectId}
          canExecute={props.canExecute}
          hasScript={props.hasScript}
          socialPackage={props.socialPackage}
        />
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
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Social posting package
        </h3>
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
            {pending ? "Writing…" : socialPackage ? "Regenerate" : "Generate captions"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      {rows.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <div key={row.label} className="rounded-md bg-muted/40 p-2 text-xs">
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
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Platform-ready captions, titles, and hashtags — generated from the final script.
        </p>
      )}
    </div>
  );
}
