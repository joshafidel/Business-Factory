"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  LIMITS,
  PHOTO_CATEGORIES,
  ROOM_LABELS,
} from "@bf/workflows/src/listing-factory/types";
import { Button, Card, CardContent, Select, Textarea } from "@/components/ui";
import {
  applyRecommendedOrderAction,
  deletePhotoAction,
  reorderPhotosAction,
  setCoverPhotoAction,
  updatePhotoAction,
} from "../actions";

interface Photo {
  id: string;
  assetId: string;
  category: string;
  roomLabel: string | null;
  note: string | null;
  isExcluded: boolean;
  isStaged: boolean;
  isAiEnhanced: boolean;
}

interface UploadItem {
  name: string;
  status: "uploading" | "done" | "failed";
  error?: string;
  file?: File;
}

/** Downscale client-side so uploads stay well inside serverless body limits
 *  (max 2048px, JPEG q0.85 — plenty for a 1080/1920 render). */
async function downscale(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 2048;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 2 * 1024 * 1024 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) throw new Error("encode failed");
    return blob;
  } catch {
    // HEIC and other undecodable formats land here — upload as-is and let
    // the server's validation report a clear error.
    return file;
  }
}

export function PhotoManager({
  projectId,
  photos,
  coverPhotoId,
  canExecute,
}: {
  projectId: string;
  photos: Photo[];
  coverPhotoId: string | null;
  canExecute: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [urlsOpen, setUrlsOpen] = useState(false);
  const [urls, setUrls] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const uploadOne = async (file: File): Promise<void> => {
    setUploads((u) => [...u.filter((x) => x.name !== file.name), { name: file.name, status: "uploading", file }]);
    try {
      const blob = await downscale(file);
      const form = new FormData();
      form.append("files", blob, file.name.replace(/\.(heic|heif|png|webp)$/i, ".jpg"));
      const res = await fetch(`/api/listing-factory/projects/${projectId}/photos`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as { error?: string; skipped?: { reason: string }[] };
      if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status})`);
      const skippedReason = body.skipped?.[0]?.reason;
      setUploads((u) =>
        u.map((x) =>
          x.name === file.name
            ? skippedReason
              ? { name: x.name, status: "failed", error: skippedReason }
              : { name: x.name, status: "done" }
            : x,
        ),
      );
    } catch (err) {
      setUploads((u) =>
        u.map((x) =>
          x.name === file.name
            ? { ...x, status: "failed", error: (err as Error).message }
            : x,
        ),
      );
    }
  };

  const handleFiles = async (files: FileList | File[]): Promise<void> => {
    setError(null);
    const list = [...files].slice(0, LIMITS.maxPhotosPerProject);
    for (const file of list) await uploadOne(file);
    setUploads((u) => u.filter((x) => x.status !== "done"));
    router.refresh();
  };

  const importUrls = async (): Promise<void> => {
    setError(null);
    const res = await fetch(`/api/listing-factory/projects/${projectId}/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: urls.split(/\n+/) }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) setError(body.error ?? "Import failed");
    else {
      setUrls("");
      setUrlsOpen(false);
      router.refresh();
    }
  };

  const onDropReorder = (targetId: string): void => {
    if (!dragId || dragId === targetId) return;
    const ids = photos.map((p) => p.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    setDragId(null);
    startTransition(async () => {
      await reorderPhotosAction(projectId, ids);
      router.refresh();
    });
  };

  const patchPhoto = (photoId: string, patch: Parameters<typeof updatePhotoAction>[1]): void => {
    startTransition(async () => {
      const res = await updatePhotoAction(photoId, patch);
      if (res.error) setError(res.error);
      router.refresh();
    });
  };

  const selectedPhoto = photos.find((p) => p.id === selected) ?? null;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            1 · Photos{" "}
            <span className="font-normal text-muted-foreground">
              ({photos.length}/{LIMITS.maxPhotosPerProject} · drag to set the tour order)
            </span>
          </h2>
          {canExecute && photos.length > 1 ? (
            <button
              type="button"
              disabled={pending}
              className="text-xs text-primary hover:underline"
              onClick={() =>
                startTransition(async () => {
                  await applyRecommendedOrderAction(projectId);
                  router.refresh();
                })
              }
            >
              Apply recommended tour order
            </button>
          ) : null}
        </div>

        {canExecute ? (
          <div
            className={`mb-4 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
            }}
          >
            <p>
              Drag listing photos here, or{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => fileInput.current?.click()}
              >
                browse
              </button>{" "}
              ·{" "}
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => setUrlsOpen((v) => !v)}
              >
                add from URLs
              </button>
            </p>
            <p className="text-xs text-muted-foreground">
              JPG, PNG, or WEBP · large photos are optimized in your browser before upload
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && void handleFiles(e.target.files)}
            />
          </div>
        ) : null}

        {urlsOpen ? (
          <div className="mb-4 space-y-2">
            <Textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              rows={3}
              placeholder={"https://…/photo-1.jpg\nhttps://…/photo-2.jpg  (one per line, https only)"}
            />
            <Button size="sm" onClick={() => void importUrls()}>
              Import photos
            </Button>
          </div>
        ) : null}

        {uploads.length > 0 ? (
          <div className="mb-3 space-y-1">
            {uploads.map((u) => (
              <div key={u.name} className="flex items-center gap-2 text-xs">
                <span
                  className={
                    u.status === "failed"
                      ? "text-destructive"
                      : u.status === "done"
                        ? "text-success"
                        : "text-muted-foreground"
                  }
                >
                  {u.status === "uploading" ? "↑" : u.status === "done" ? "✓" : "✕"}
                </span>
                <span className="truncate">{u.name}</span>
                {u.error ? <span className="text-destructive">{u.error}</span> : null}
                {u.status === "failed" && u.file ? (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => void uploadOne(u.file!)}
                  >
                    retry
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}

        {photos.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No photos yet — the video needs at least one.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {photos.map((photo, i) => (
              <div
                key={photo.id}
                draggable={canExecute}
                onDragStart={() => setDragId(photo.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onDropReorder(photo.id);
                }}
                onClick={() => setSelected(selected === photo.id ? null : photo.id)}
                className={`group relative cursor-pointer overflow-hidden rounded-md border ${
                  selected === photo.id ? "border-primary ring-2 ring-primary/40" : "border-border"
                } ${photo.isExcluded ? "opacity-40" : ""}`}
              >
                <img
                  src={`/api/assets/raw?id=${photo.assetId}`}
                  alt={photo.roomLabel ?? `Photo ${i + 1}`}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                  {i + 1}
                </span>
                {photo.id === coverPhotoId ? (
                  <span className="absolute right-1 top-1 rounded bg-primary/90 px-1 text-[10px] font-medium text-primary-foreground">
                    cover
                  </span>
                ) : null}
                {photo.roomLabel ? (
                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1 py-0.5 text-[10px] text-white">
                    {photo.roomLabel}
                    {photo.isStaged ? " · staged" : ""}
                  </span>
                ) : photo.isStaged ? (
                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1 py-0.5 text-[10px] text-white">
                    virtually staged
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {selectedPhoto && canExecute ? (
          <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Room label</span>
                <Select
                  value={selectedPhoto.roomLabel ?? ""}
                  onChange={(e) => patchPhoto(selectedPhoto.id, { roomLabel: e.target.value || null })}
                >
                  <option value="">— none —</option>
                  {ROOM_LABELS.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Type</span>
                <Select
                  value={selectedPhoto.category}
                  onChange={(e) => patchPhoto(selectedPhoto.id, { category: e.target.value })}
                >
                  {PHOTO_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">
                Factual note for the script (optional — e.g. “quartz counters, 2023 range”)
              </span>
              <Textarea
                rows={2}
                defaultValue={selectedPhoto.note ?? ""}
                onBlur={(e) => {
                  if (e.target.value !== (selectedPhoto.note ?? "")) {
                    patchPhoto(selectedPhoto.id, { note: e.target.value || null });
                  }
                }}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {(
                [
                  ["isExcluded", "Exclude from video"],
                  ["isStaged", "Virtually staged"],
                  ["isAiEnhanced", "AI-enhanced"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedPhoto[key])}
                    onChange={(e) => patchPhoto(selectedPhoto.id, { [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() =>
                  startTransition(async () => {
                    await setCoverPhotoAction(projectId, selectedPhoto.id);
                    router.refresh();
                  })
                }
              >
                Set as cover
              </button>
              <button
                type="button"
                className="text-destructive hover:underline"
                onClick={() =>
                  startTransition(async () => {
                    await deletePhotoAction(selectedPhoto.id);
                    setSelected(null);
                    router.refresh();
                  })
                }
              >
                Delete photo
              </button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
