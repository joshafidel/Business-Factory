"use client";

import { useActionState, useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import { saveCostLimitAction } from "./actions";

export function CostLimitForm() {
  const [scope, setScope] = useState("DAILY");
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => saveCostLimitAction(formData),
    {},
  );
  const needsKey = scope === "PROVIDER" || scope === "MODULE";

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="scope">Scope</Label>
        <Select
          id="scope"
          name="scope"
          className="w-full"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="RUN">Per run</option>
          <option value="DAILY">Daily total</option>
          <option value="MONTHLY">Monthly total</option>
          <option value="PROVIDER">Per provider (monthly)</option>
          <option value="MODULE">Per module (monthly)</option>
        </Select>
      </div>
      {needsKey ? (
        <div className="space-y-1.5">
          <Label htmlFor="scopeKey">{scope === "PROVIDER" ? "Provider key" : "Module key"}</Label>
          <Input
            id="scopeKey"
            name="scopeKey"
            placeholder={scope === "PROVIDER" ? "anthropic" : "kids-shorts"}
            className="font-mono"
          />
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="limitUsd">Limit (USD)</Label>
        <Input id="limitUsd" name="limitUsd" type="number" step="0.01" min="0.01" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="warnAtPercent">Warn at (%)</Label>
        <Input
          id="warnAtPercent"
          name="warnAtPercent"
          type="number"
          defaultValue={80}
          min={1}
          max={100}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isHardStop" defaultChecked className="h-4 w-4" />
        Hard stop (block execution at limit)
      </label>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Save limit"}
      </Button>
    </form>
  );
}
