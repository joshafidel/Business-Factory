"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { VIDEO_TEMPLATES } from "@bf/workflows/src/listing-factory/templates";
import {
  VIDEO_FORMATS,
  type ListingOptions,
} from "@bf/workflows/src/listing-factory/types";
import { Button, Card, CardContent, Input, Label, Select } from "@/components/ui";
import { updateSettingsAction } from "../actions";

const TOGGLES: { key: keyof ListingOptions; label: string }[] = [
  { key: "voiceover", label: "Voice-over" },
  { key: "captions", label: "Captions" },
  { key: "music", label: "Music" },
  { key: "showPrice", label: "Show price" },
  { key: "showAddress", label: "Show address" },
  { key: "agentOutro", label: "Agent outro card" },
];

export function StylePanel({
  projectId,
  format,
  style,
  options,
  canExecute,
}: {
  projectId: string;
  format: string;
  style: string;
  options: ListingOptions;
  canExecute: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (
      _prev: { error?: string; saved?: boolean },
      formData: FormData,
    ): Promise<{ error?: string; saved?: boolean }> => {
      const res = await updateSettingsAction(projectId, formData);
      router.refresh();
      return res.error ? { error: res.error } : { saved: true };
    },
    {},
  );

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="mb-3 text-sm font-semibold">3 · Style & format</h2>
        <form action={formAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Video style</Label>
            <div className="grid grid-cols-2 gap-2">
              {Object.values(VIDEO_TEMPLATES).map((t) => (
                <label
                  key={t.key}
                  className="flex cursor-pointer flex-col gap-0.5 rounded-md border border-border p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <input
                      type="radio"
                      name="style"
                      value={t.key}
                      defaultChecked={style === t.key}
                      disabled={!canExecute}
                    />
                    {t.name}
                  </span>
                  <span className="text-muted-foreground">{t.description}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="format" className="text-xs">
                Format
              </Label>
              <Select id="format" name="format" defaultValue={format} disabled={!canExecute}>
                {Object.entries(VIDEO_FORMATS).map(([key, f]) => (
                  <option key={key} value={key}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="targetSeconds" className="text-xs">
                Target length (seconds)
              </Label>
              <Input
                id="targetSeconds"
                name="targetSeconds"
                type="number"
                min={15}
                max={180}
                defaultValue={options.targetSeconds}
                disabled={!canExecute}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="platform" className="text-xs">
              Primary platform
            </Label>
            <Select id="platform" name="platform" defaultValue={options.platform} disabled={!canExecute}>
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram Reels</option>
              <option value="youtube">YouTube Shorts</option>
              <option value="listing-page">Listing page / website</option>
            </Select>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {TOGGLES.map((t) => (
              <label key={t.key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name={t.key}
                  defaultChecked={Boolean(options[t.key])}
                  disabled={!canExecute}
                />
                {t.label}
              </label>
            ))}
          </div>
          {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
          {canExecute ? (
            <Button type="submit" disabled={pending} variant="outline" className="w-full">
              {pending ? "Saving…" : state.saved ? "Saved ✓ — Save again" : "Save style settings"}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
