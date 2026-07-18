"use client";

import { useActionState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import { addMemberAction, changeMemberRoleAction } from "./actions";

export function AddMemberForm() {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => addMemberAction(formData),
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="member-name">Name</Label>
        <Input id="member-name" name="name" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="member-email">Email</Label>
        <Input id="member-email" name="email" type="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="member-role">Role</Label>
        <Select id="member-role" name="role" className="w-full" defaultValue="VIEWER">
          <option value="ADMIN">Administrator</option>
          <option value="OPERATOR">Operator</option>
          <option value="REVIEWER">Reviewer</option>
          <option value="VIEWER">Viewer</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="member-password">Temporary password</Label>
        <Input id="member-password" name="password" type="password" minLength={10} required />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Adding…" : "Add member"}
      </Button>
    </form>
  );
}

export function RoleSelect({ memberId, currentRole }: { memberId: string; currentRole: string }) {
  return (
    <Select
      defaultValue={currentRole}
      className="h-7 text-xs"
      onChange={(e) => void changeMemberRoleAction(memberId, e.target.value)}
    >
      <option value="ADMIN">ADMIN</option>
      <option value="OPERATOR">OPERATOR</option>
      <option value="REVIEWER">REVIEWER</option>
      <option value="VIEWER">VIEWER</option>
    </Select>
  );
}
