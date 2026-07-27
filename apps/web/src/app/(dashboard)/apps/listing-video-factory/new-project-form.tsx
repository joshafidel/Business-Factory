"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Button, Input, Label } from "@/components/ui";
import { createProjectAction, importListingPageAction } from "./actions";

export function NewProjectForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"manual" | "import">("import");
  const [manualState, manualAction, manualPending] = useActionState(createProjectAction, {});
  const [importState, importAction, importPending] = useActionState(importListingPageAction, {});

  useEffect(() => {
    const projectId = manualState.projectId ?? importState.projectId;
    if (projectId) router.push(`/apps/listing-video-factory/${projectId}`);
  }, [manualState.projectId, importState.projectId, router]);

  return (
    <div className="space-y-3">
      <div className="flex rounded-md border border-border p-0.5 text-xs">
        {(
          [
            ["import", "From a listing page"],
            ["manual", "Start blank"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={`flex-1 rounded px-2 py-1.5 font-medium transition-colors ${
              mode === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "import" ? (
        <form action={importAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="lvf-url">Listing page URL</Label>
            <Input id="lvf-url" name="url" type="url" placeholder="https://…/listings/12-maple-st" required />
            <p className="text-xs text-muted-foreground">
              We read the page once and pull the realtor (name, phone, brokerage), property facts,
              and photos from its listing data — then everything is editable.
            </p>
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" name="rightsConfirmed" className="mt-0.5" required />
            <span>I confirm that I own or have permission to use this page’s photographs and listing materials.</span>
          </label>
          {importState.error ? <p className="text-xs text-destructive">{importState.error}</p> : null}
          {importState.projectId ? (
            <p className="text-xs text-success">
              Imported {importState.photoCount ?? 0} photo{importState.photoCount === 1 ? "" : "s"}
              {importState.agentName ? ` · agent: ${importState.agentName}` : ""} — opening the editor…
            </p>
          ) : null}
          <Button type="submit" disabled={importPending} className="w-full">
            {importPending ? "Importing…" : "Import & create project"}
          </Button>
        </form>
      ) : (
        <form action={manualAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="lvf-name">Project name</Label>
            <Input id="lvf-name" name="name" placeholder="12 Maple St — Fast Social" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lvf-address">Property address</Label>
            <Input id="lvf-address" name="address" placeholder="12 Maple St, Pittsburgh, PA" required />
          </div>
          {manualState.error ? <p className="text-xs text-destructive">{manualState.error}</p> : null}
          <Button type="submit" disabled={manualPending} className="w-full">
            {manualPending ? "Creating…" : "Create project"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Everything else — photos, details, style — is added in the editor. Drafts save as you go.
          </p>
        </form>
      )}
    </div>
  );
}
