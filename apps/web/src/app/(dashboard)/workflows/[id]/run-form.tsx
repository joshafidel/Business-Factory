"use client";

import { useActionState } from "react";
import { Button, Label, Textarea } from "@/components/ui";
import { runWorkflowAction } from "../actions";

export function RunWorkflowForm({ workflowKey }: { workflowKey: string }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) =>
      runWorkflowAction(workflowKey, formData),
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="input">Input (JSON)</Label>
        <Textarea
          id="input"
          name="input"
          defaultValue={`{\n  "topic": "How to plan a small vegetable garden"\n}`}
          rows={5}
        />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Starting…" : "Start run"}
      </Button>
    </form>
  );
}
