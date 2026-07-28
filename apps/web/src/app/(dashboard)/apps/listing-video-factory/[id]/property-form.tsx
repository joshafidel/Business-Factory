"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { type ListingProperty } from "@bf/workflows/src/listing-factory/types";
import { Button, Card, CardContent, Input, Label, Textarea } from "@/components/ui";
import { updatePropertyAction } from "../actions";

const FIELDS: { key: keyof ListingProperty; label: string; placeholder?: string }[] = [
  { key: "price", label: "Listing price", placeholder: "$459,000" },
  { key: "propertyType", label: "Property type", placeholder: "Single-family" },
  { key: "beds", label: "Bedrooms", placeholder: "3" },
  { key: "baths", label: "Bathrooms", placeholder: "2" },
  { key: "sqft", label: "Square footage", placeholder: "1,850" },
  { key: "neighborhood", label: "Neighborhood" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "mlsNumber", label: "MLS number" },
  { key: "listingUrl", label: "Listing URL (reference only)" },
  { key: "agentName", label: "Agent name" },
  { key: "brokerage", label: "Brokerage" },
  { key: "agentPhone", label: "Agent phone" },
  { key: "agentEmail", label: "Agent email" },
];

export function PropertyForm({
  projectId,
  projectName,
  property,
  rightsConfirmed,
  canExecute,
}: {
  projectId: string;
  projectName: string;
  property: ListingProperty;
  rightsConfirmed: boolean;
  canExecute: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (
      _prev: { error?: string; saved?: boolean },
      formData: FormData,
    ): Promise<{ error?: string; saved?: boolean }> => {
      const res = await updatePropertyAction(projectId, formData);
      router.refresh();
      return res.error ? { error: res.error } : { saved: true };
    },
    {},
  );

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="mb-3 text-sm font-semibold">2 · Property details</h2>
        <form action={formAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="projectName">Project name</Label>
            <Input
              id="projectName"
              name="projectName"
              defaultValue={projectName}
              disabled={!canExecute}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Address *</Label>
            <Input
              id="address"
              name="address"
              defaultValue={property.address}
              required
              disabled={!canExecute}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={f.key} className="text-xs">
                  {f.label}
                </Label>
                <Input
                  id={f.key}
                  name={f.key}
                  defaultValue={property[f.key] ?? ""}
                  placeholder={f.placeholder}
                  disabled={!canExecute}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">
              Listing description{" "}
              <span className="font-normal text-muted-foreground">
                (paste it — the script only uses facts stated here)
              </span>
            </Label>
            <Textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={property.description}
              disabled={!canExecute}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="callToAction">Call to action</Label>
            <Input
              id="callToAction"
              name="callToAction"
              defaultValue={property.callToAction}
              placeholder="Book a private tour this weekend"
              disabled={!canExecute}
            />
          </div>
          <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
            <input
              type="checkbox"
              name="rightsConfirmed"
              defaultChecked={rightsConfirmed}
              disabled={!canExecute}
              className="mt-0.5"
            />
            <span>
              I confirm that I own or have permission to use these photographs and listing
              materials. <span className="text-muted-foreground">(required before rendering)</span>
            </span>
          </label>
          {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
          {canExecute ? (
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Saving…" : state.saved ? "Saved ✓ — Save again" : "Save property details"}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
