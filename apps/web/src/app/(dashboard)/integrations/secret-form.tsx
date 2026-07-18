"use client";

import { useActionState, useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import { saveSecretAction } from "./actions";

export function SecretForm({ integrationId }: { integrationId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => saveSecretAction(formData),
    {},
  );

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-full" onClick={() => setOpen(true)}>
        Add credential
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="integrationId" value={integrationId} />
      <div className="space-y-1">
        <Label htmlFor={`key-${integrationId}`}>Credential key</Label>
        <Input
          id={`key-${integrationId}`}
          name="key"
          placeholder="api_key"
          required
          className="font-mono"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`source-${integrationId}`}>Storage</Label>
        <Select id={`source-${integrationId}`} name="source" className="w-full" defaultValue="ENV">
          <option value="ENV">Env var name (recommended)</option>
          <option value="ENCRYPTED">Encrypt value in DB</option>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`value-${integrationId}`}>Value</Label>
        <Input
          id={`value-${integrationId}`}
          name="value"
          type="password"
          placeholder="MY_SERVICE_API_KEY or the secret itself"
          required
        />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending} className="flex-1">
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
