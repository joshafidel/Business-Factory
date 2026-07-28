"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type ListingScript } from "@bf/workflows/src/listing-factory/types";
import { Button, Card, CardContent, Input, Textarea } from "@/components/ui";
import { generateScriptAction, saveScriptAction } from "../actions";

interface Warning {
  kind: "fair-housing" | "unsupported-claim";
  sceneIndex: number;
  matched: string;
  message: string;
}

export function ScriptPanel({
  projectId,
  script,
  warnings,
  photoCount,
  photos,
  voiceover,
  canExecute,
}: {
  projectId: string;
  script: ListingScript | null;
  warnings: Warning[];
  photoCount: number;
  photos: { id: string; assetId: string; roomLabel: string | null }[];
  voiceover: boolean;
  canExecute: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<ListingScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = draft ?? script;

  const generate = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await generateScriptAction(projectId);
      if (res.error) setError(res.error);
      setDraft(null);
      router.refresh();
    });
  };

  const save = (): void => {
    if (!current) return;
    setError(null);
    startTransition(async () => {
      const res = await saveScriptAction(projectId, current);
      if (res.error) setError(res.error);
      setDraft(null);
      router.refresh();
    });
  };

  const patchScene = (i: number, patch: Partial<ListingScript["scenes"][number]>): void => {
    if (!current) return;
    const scenes = current.scenes.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    setDraft({ ...current, scenes });
  };

  const warningsFor = (sceneIndex: number): Warning[] =>
    warnings.filter((w) => w.sceneIndex === sceneIndex);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Narration{" "}
            <span className="font-normal text-muted-foreground">
              ({voiceover ? "narration + captions" : "captions only"})
            </span>
          </h2>
          {canExecute ? (
            <Button
              size="sm"
              variant={script ? "outline" : "default"}
              disabled={pending || photoCount === 0}
              onClick={generate}
            >
              {pending ? "Working…" : script ? "Regenerate" : "Generate script"}
            </Button>
          ) : null}
        </div>

        {photoCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            Upload photos first — one scene per photo.
          </p>
        ) : !current ? (
          <p className="text-sm text-muted-foreground">
            The script generator writes one scene per photo using only your property facts, room
            labels, and notes — nothing invented. You can edit every line before rendering.
          </p>
        ) : (
          <div className="space-y-3">
            {warnings.length > 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
                <p className="mb-1 font-semibold">
                  {warnings.length} content warning{warnings.length === 1 ? "" : "s"} — review
                  before rendering
                </p>
                <ul className="space-y-0.5">
                  {warnings.slice(0, 6).map((w, i) => (
                    <li key={i}>
                      <span className="font-medium">
                        {w.kind === "fair-housing" ? "Fair housing" : "Unsupported claim"}
                      </span>{" "}
                      · “{w.matched}” — {w.message}
                    </li>
                  ))}
                  {warnings.length > 6 ? <li>…and {warnings.length - 6} more</li> : null}
                </ul>
              </div>
            ) : null}

            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Hook (opening line)</span>
              <Input
                value={current.hook}
                disabled={!canExecute}
                onChange={(e) => setDraft({ ...current, hook: e.target.value })}
              />
            </label>

            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {current.scenes.map((scene, i) => {
                const photo = photos.find((p) => p.id === scene.photoId) ?? photos[i];
                const sceneWarnings = warningsFor(i);
                return (
                  <div key={i} className="flex gap-2 rounded-md border border-border p-2">
                    {photo ? (
                      <img
                        src={`/api/assets/raw?id=${photo.assetId}`}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Scene {i + 1}
                        {photo?.roomLabel ? ` · ${photo.roomLabel}` : ""}
                      </p>
                      {voiceover ? (
                        <Textarea
                          rows={2}
                          value={scene.narration}
                          disabled={!canExecute}
                          placeholder="Narration"
                          className="text-xs"
                          onChange={(e) => patchScene(i, { narration: e.target.value })}
                        />
                      ) : null}
                      <Input
                        value={scene.caption}
                        disabled={!canExecute}
                        placeholder="On-screen caption (max 8 words)"
                        className="h-7 text-xs"
                        onChange={(e) => patchScene(i, { caption: e.target.value })}
                      />
                      {sceneWarnings.length > 0 ? (
                        <p className="text-[11px] text-warning">
                          ⚠ {sceneWarnings.map((w) => w.message).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Outro line</span>
                <Input
                  value={current.outro}
                  disabled={!canExecute}
                  onChange={(e) => setDraft({ ...current, outro: e.target.value })}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Call to action</span>
                <Input
                  value={current.cta}
                  disabled={!canExecute}
                  onChange={(e) => setDraft({ ...current, cta: e.target.value })}
                />
              </label>
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {canExecute && draft ? (
              <Button size="sm" disabled={pending} onClick={save}>
                {pending ? "Saving…" : "Save script edits"}
              </Button>
            ) : null}
          </div>
        )}
        {!current && error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
