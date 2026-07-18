"use client";

import { useActionState } from "react";
import { Button, Input, Label, Textarea } from "@/components/ui";
import { testPromptAction, updatePromptAction } from "../actions";

export function EditPromptForm({
  promptId,
  currentTemplate,
}: {
  promptId: string;
  currentTemplate: string;
}) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => updatePromptAction(formData),
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="promptId" value={promptId} />
      <div className="space-y-1.5">
        <Label htmlFor="template">Template</Label>
        <Textarea id="template" name="template" rows={8} defaultValue={currentTemplate} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="changelog">Changelog</Label>
        <Input id="changelog" name="changelog" placeholder="What changed?" />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Save as new version"}
      </Button>
    </form>
  );
}

export function TestPromptForm({ defaultTemplate }: { defaultTemplate: string }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string; rendered?: string; output?: string }, formData: FormData) =>
      testPromptAction(formData),
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="test-template">Template</Label>
        <Textarea
          id="test-template"
          name="template"
          rows={5}
          defaultValue={defaultTemplate}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="variables">Variables (JSON)</Label>
        <Textarea
          id="variables"
          name="variables"
          rows={3}
          defaultValue={`{\n  "topic": "container gardening"\n}`}
        />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.output ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Rendered prompt</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
            {state.rendered}
          </pre>
          <p className="text-xs font-medium text-muted-foreground">Mock output</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
            {state.output}
          </pre>
        </div>
      ) : null}
      <Button type="submit" variant="outline" disabled={pending} className="w-full">
        {pending ? "Testing…" : "Run test"}
      </Button>
    </form>
  );
}
