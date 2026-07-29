"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { deletePurchaseAction, endSubscriptionAction, savePurchaseAction } from "./actions";

/** Serializable line item passed from the server page. */
export interface PurchaseItemData {
  id: string;
  kind: "ONE_TIME" | "SUBSCRIPTION";
  vendor: string;
  name: string;
  amountUsd: number;
  cadence: string | null;
  date: string | null; // yyyy-mm-dd (purchase date or subscription start)
  endedAt: string | null;
  isEstimate: boolean;
  notes: string | null;
  /** Pre-formatted display strings (server-side) */
  amountLabel: string;
  totalLabel: string;
  metaLabel: string;
}

const VENDOR_EMOJI: Record<string, string> = {
  anthropic: "🧠",
  openai: "🎨",
  elevenlabs: "🎙️",
  higgsfield: "🎞️",
  "fal.ai": "✨",
  vercel: "▲",
  neon: "🐘",
  picsart: "🖼️",
};

/**
 * One spending line item: a tap-to-expand dropdown row. Collapsed it shows
 * the essentials (name, price, estimate flag); expanded it shows the story
 * (dates, notes, total math) and — for admins — an inline edit form. Saving
 * an edit marks the amount as confirmed (clears the estimate badge).
 */
export function PurchaseItem({ item, canManage }: { item: PurchaseItemData; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const emoji = VENDOR_EMOJI[item.vendor.toLowerCase()] ?? "💳";
  const ended = Boolean(item.endedAt);

  const run = async (fn: () => Promise<{ error?: string }>) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res.error) setError(res.error);
    else {
      setEditing(false);
      router.refresh();
    }
  };

  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer select-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <span className="text-xl">{emoji}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-medium", ended && "line-through")}>
            {item.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{item.metaLabel}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums">{item.amountLabel}</span>
          {item.kind === "SUBSCRIPTION" && !ended ? (
            <span className="block text-xs text-muted-foreground tabular-nums">
              {item.totalLabel}
            </span>
          ) : null}
        </span>
        {item.isEstimate ? <Badge variant="warning">estimate</Badge> : null}
        {ended ? <Badge>cancelled</Badge> : null}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="space-y-3 border-t border-border p-3 text-sm">
        {item.notes ? <p className="text-muted-foreground">{item.notes}</p> : null}
        <p className="text-xs text-muted-foreground">{item.totalLabel}</p>

        {canManage && !editing ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              {item.isEstimate ? "Set real amount" : "Edit"}
            </Button>
            {item.kind === "SUBSCRIPTION" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => endSubscriptionAction(item.id))}
              >
                {ended ? "Reactivate" : "Mark cancelled"}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => {
                if (confirm(`Remove “${item.name}” from the list?`)) {
                  void run(() => deletePurchaseAction(item.id));
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
        ) : null}

        {canManage && editing ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            action={(formData) => run(() => savePurchaseAction(item.id, formData))}
          >
            <input type="hidden" name="kind" value={item.kind} />
            <div className="space-y-1">
              <Label htmlFor={`vendor-${item.id}`}>Vendor</Label>
              <Input id={`vendor-${item.id}`} name="vendor" defaultValue={item.vendor} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`name-${item.id}`}>What is it?</Label>
              <Input id={`name-${item.id}`} name="name" defaultValue={item.name} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`amount-${item.id}`}>
                {item.kind === "SUBSCRIPTION" ? "Price per cycle (USD)" : "Amount paid (USD)"}
              </Label>
              <Input
                id={`amount-${item.id}`}
                name="amountUsd"
                type="number"
                step="0.01"
                min="0"
                defaultValue={item.amountUsd}
                required
              />
            </div>
            {item.kind === "SUBSCRIPTION" ? (
              <div className="space-y-1">
                <Label htmlFor={`cadence-${item.id}`}>Billing cycle</Label>
                <Select
                  id={`cadence-${item.id}`}
                  name="cadence"
                  defaultValue={item.cadence ?? "monthly"}
                  className="w-full"
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor={`date-${item.id}`}>
                {item.kind === "SUBSCRIPTION" ? "Subscribed since" : "Purchase date"}
              </Label>
              <Input
                id={`date-${item.id}`}
                name="date"
                type="date"
                defaultValue={item.date ?? ""}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`notes-${item.id}`}>Notes</Label>
              <Textarea
                id={`notes-${item.id}`}
                name="notes"
                defaultValue={item.notes ?? ""}
                className="min-h-16 font-sans"
              />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </details>
  );
}
