"use client";

import { useActionState } from "react";
import { Button, Input, Label, Textarea } from "@/components/ui";
import { createPromptAction } from "./actions";

export function CreatePromptForm() {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => createPromptAction(formData),
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="key">Key</Label>
        <Input id="key" name="key" required placeholder="research-brief" className="font-mono" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required placeholder="Research brief" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Input id="description" name="description" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="template">Template</Label>
        <Textarea
          id="template"
          name="template"
          rows={6}
          required
          placeholder={"Research the topic {{topic}} and produce a structured brief."}
        />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create prompt"}
      </Button>
    </form>
  );
}
