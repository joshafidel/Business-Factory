"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button, Input, Label } from "@/components/ui";
import { createProjectAction } from "./actions";

export function NewProjectForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createProjectAction, {});

  useEffect(() => {
    if (state.projectId) router.push(`/apps/listing-video-factory/${state.projectId}`);
  }, [state.projectId, router]);

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="lvf-name">Project name</Label>
        <Input id="lvf-name" name="name" placeholder="12 Maple St — Fast Social" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lvf-address">Property address</Label>
        <Input id="lvf-address" name="address" placeholder="12 Maple St, Pittsburgh, PA" required />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create project"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Everything else — photos, details, style — is added in the editor. Drafts save as you go.
      </p>
    </form>
  );
}
