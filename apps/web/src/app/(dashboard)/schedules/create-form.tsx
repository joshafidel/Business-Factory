"use client";

import { useActionState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import { createScheduleAction } from "./actions";

export function CreateScheduleForm({ workflows }: { workflows: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => createScheduleAction(formData),
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required placeholder="Nightly content draft" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="workflowId">Workflow</Label>
        <Select id="workflowId" name="workflowId" required className="w-full">
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cron">Cron expression</Label>
        <Input id="cron" name="cron" required placeholder="0 9 * * 1-5" className="font-mono" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Input id="timezone" name="timezone" defaultValue="UTC" />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending || workflows.length === 0} className="w-full">
        {workflows.length === 0 ? "No active workflows" : pending ? "Creating…" : "Create schedule"}
      </Button>
    </form>
  );
}
