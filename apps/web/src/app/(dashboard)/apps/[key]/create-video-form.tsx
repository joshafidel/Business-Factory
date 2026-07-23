"use client";

import { useActionState } from "react";
import { Button, Input, Label } from "@/components/ui";
import { createVideoAction } from "./actions";

export function CreateVideoForm({ workflowKey }: { workflowKey: string }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) =>
      createVideoAction(workflowKey, formData),
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="animal">Animal (optional)</Label>
        <Input id="animal" name="animal" placeholder="Surprise me" />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Starting…" : "Make a video"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Takes under a minute, then appears in Approvals for your review.
      </p>
    </form>
  );
}
