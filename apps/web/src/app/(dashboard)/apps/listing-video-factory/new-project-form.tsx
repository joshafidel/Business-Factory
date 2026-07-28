"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Button, Input, Label } from "@/components/ui";
import { createProjectAction, importFeedListingAction, importListingPageAction } from "./actions";

interface FeedRow {
  mlsId: string;
  address: string;
  city: string;
  state: string;
  price: string;
  beds: string;
  baths: string;
  sqft: string;
  photoCount: number;
  coverPhoto: string | null;
  agentName: string;
  brokerage: string;
}

export function NewProjectForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"feed" | "import" | "manual">("feed");
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
            ["feed", "MLS feed"],
            ["import", "Listing page"],
            ["manual", "Blank"],
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

      {mode === "feed" ? <FeedBrowser /> : null}

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
      ) : null}

      {mode === "manual" ? (
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
      ) : null}
    </div>
  );
}

function FeedBrowser() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const search = async (query: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/listing-factory/feed?q=${encodeURIComponent(query)}`);
      const body = (await res.json()) as { error?: string; isDemo?: boolean; listings?: FeedRow[] };
      if (!res.ok) throw new Error(body.error ?? "Feed unavailable");
      setRows(body.listings ?? []);
      setIsDemo(Boolean(body.isDemo));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void search("");
  }, []);

  const importListing = (mlsId: string): void => {
    setImporting(mlsId);
    setError(null);
    startTransition(async () => {
      const res = await importFeedListingAction(mlsId);
      if (res.error) {
        setError(res.error);
        setImporting(null);
      } else if (res.projectId) {
        router.push(`/apps/listing-video-factory/${res.projectId}`);
      }
    });
  };

  return (
    <div className="space-y-2">
      {isDemo ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          <span className="font-semibold">Sample MLS feed.</span> Add licensed feed credentials
          (SIMPLYRETS_USERNAME / SIMPLYRETS_PASSWORD in Vercel) to browse real active listings —
          the docs explain how to get a feed.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search(q)}
          placeholder="Search city, street, keyword…"
        />
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void search(q)}>
          {loading ? "…" : "Search"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {rows?.map((row) => (
          <div key={row.mlsId} className="flex items-center gap-2 rounded-md border border-border p-2">
            {row.coverPhoto ? (
              <img
                src={row.coverPhoto}
                alt=""
                className="h-12 w-12 shrink-0 rounded object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
                🏠
              </div>
            )}
            <div className="min-w-0 flex-1 text-xs">
              <p className="truncate font-medium">{row.address}</p>
              <p className="truncate text-muted-foreground">
                {[row.city, row.state].filter(Boolean).join(", ")}
                {row.price ? ` · ${row.price}` : ""}
                {row.beds ? ` · ${row.beds} bd` : ""}
                {row.baths ? ` / ${row.baths} ba` : ""} · {row.photoCount} photos
              </p>
              {row.agentName ? (
                <p className="truncate text-muted-foreground">
                  {row.agentName}
                  {row.brokerage ? ` · ${row.brokerage}` : ""}
                </p>
              ) : null}
            </div>
            <Button size="sm" disabled={importing !== null} onClick={() => importListing(row.mlsId)}>
              {importing === row.mlsId ? "Importing…" : "Make video"}
            </Button>
          </div>
        ))}
        {rows !== null && rows.length === 0 && !loading ? (
          <p className="py-3 text-center text-xs text-muted-foreground">No listings found.</p>
        ) : null}
      </div>
    </div>
  );
}
