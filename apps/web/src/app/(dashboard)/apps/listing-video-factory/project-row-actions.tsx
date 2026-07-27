"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteProjectAction, duplicateProjectAction } from "./actions";

export function ProjectRowActions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  return (
    <span className="flex items-center gap-1 text-xs">
      <button
        type="button"
        disabled={pending}
        className="rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Duplicate project"
        onClick={() =>
          startTransition(async () => {
            const res = await duplicateProjectAction(projectId);
            if (res.projectId) router.push(`/apps/listing-video-factory/${res.projectId}`);
          })
        }
      >
        ⧉
      </button>
      {confirming ? (
        <button
          type="button"
          disabled={pending}
          className="rounded bg-destructive/10 px-1.5 py-1 font-medium text-destructive hover:bg-destructive/20"
          onClick={() =>
            startTransition(async () => {
              await deleteProjectAction(projectId);
              setConfirming(false);
              router.refresh();
            })
          }
        >
          Delete?
        </button>
      ) : (
        <button
          type="button"
          className="rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          title="Delete project"
          onClick={() => setConfirming(true)}
          onBlur={() => setConfirming(false)}
        >
          ✕
        </button>
      )}
    </span>
  );
}
