"use client";

import { useActionState } from "react";
import { Button, Label, Textarea } from "@/components/ui";
import { decideApprovalAction } from "../actions";

export function DecisionForm({ approvalRequestId }: { approvalRequestId: string }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => decideApprovalAction(formData),
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="approvalRequestId" value={approvalRequestId} />
      <div className="space-y-1.5">
        <Label htmlFor="comment">Comment (optional)</Label>
        <Textarea id="comment" name="comment" rows={3} className="font-sans" />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <div className="grid grid-cols-1 gap-2">
        <Button type="submit" name="decision" value="APPROVED" variant="success" disabled={pending}>
          Approve
        </Button>
        <Button
          type="submit"
          name="decision"
          value="REVISION_REQUESTED"
          variant="outline"
          disabled={pending}
        >
          Request revision
        </Button>
        <Button
          type="submit"
          name="decision"
          value="REJECTED"
          variant="destructive"
          disabled={pending}
        >
          Reject
        </Button>
      </div>
    </form>
  );
}
