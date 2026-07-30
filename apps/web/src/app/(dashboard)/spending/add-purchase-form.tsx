"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { addPurchaseAction } from "./actions";

/** Collapsible "add a purchase" form — tucked away until needed. */
export function AddPurchaseForm() {
  const router = useRouter();
  const [kind, setKind] = React.useState<"ONE_TIME" | "SUBSCRIPTION">("ONE_TIME");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const detailsRef = React.useRef<HTMLDetailsElement>(null);

  return (
    <details ref={detailsRef} className="group rounded-lg border border-dashed border-border">
      <summary className="flex cursor-pointer select-none items-center gap-2 p-3 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
        <Plus className="h-4 w-4" /> Add a purchase or subscription
      </summary>
      <form
        className="grid gap-3 border-t border-border p-3 sm:grid-cols-2"
        action={async (formData) => {
          setBusy(true);
          setError(null);
          const res = await addPurchaseAction(formData);
          setBusy(false);
          if (res.error) setError(res.error);
          else {
            detailsRef.current?.removeAttribute("open");
            router.refresh();
          }
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="add-kind">Type</Label>
          <Select
            id="add-kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "ONE_TIME" | "SUBSCRIPTION")}
            className="w-full"
          >
            <option value="ONE_TIME">One-time purchase (tokens / credits)</option>
            <option value="SUBSCRIPTION">Recurring subscription</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="add-vendor">Vendor</Label>
          <Input id="add-vendor" name="vendor" placeholder="e.g. OpenAI" required />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="add-name">What is it?</Label>
          <Input id="add-name" name="name" placeholder="e.g. API credit top-up" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="add-amount">
            {kind === "SUBSCRIPTION" ? "Price per cycle (USD)" : "Amount paid (USD)"}
          </Label>
          <Input id="add-amount" name="amountUsd" type="number" step="0.01" min="0" required />
        </div>
        {kind === "SUBSCRIPTION" ? (
          <div className="space-y-1">
            <Label htmlFor="add-cadence">Billing cycle</Label>
            <Select id="add-cadence" name="cadence" defaultValue="monthly" className="w-full">
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </Select>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="add-date">{kind === "SUBSCRIPTION" ? "Since" : "Date"}</Label>
          <Input id="add-date" name="date" type="date" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="add-notes">Notes (optional)</Label>
          <Textarea id="add-notes" name="notes" className="min-h-16 font-sans" />
        </div>
        <div className="sm:col-span-2">
          <Button size="sm" type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add it"}
          </Button>
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
      </form>
    </details>
  );
}
