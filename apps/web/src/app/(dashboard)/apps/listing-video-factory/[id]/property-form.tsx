"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { type ListingProperty } from "@bf/workflows/src/listing-factory/types";
import { Button, Card, CardContent, Input, Label, Textarea } from "@/components/ui";
import { updatePropertyAction } from "../actions";

/**
 * Compact listing details: the listing link and the realtor's contact info
 * up front (what shows on the listing card), core facts in one row, and
 * everything else tucked into a collapsible section. Collapsed inputs still
 * submit, so saving never wipes hidden fields.
 */
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
        <h2 className="mb-3 text-sm font-semibold">Listing details</h2>
        <form action={formAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="listingUrl">Zillow / listing link</Label>
            <Input
              id="listingUrl"
              name="listingUrl"
              type="url"
              defaultValue={property.listingUrl}
              placeholder="https://www.zillow.com/homedetails/…"
              disabled={!canExecute}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Address *</Label>
            <Input id="address" name="address" defaultValue={property.address} required disabled={!canExecute} />
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-2.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Realtor & contact
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["agentName", "Name"],
                  ["brokerage", "Brokerage"],
                  ["agentPhone", "Phone"],
                  ["agentEmail", "Email"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={key} className="text-xs">
                    {label}
                  </Label>
                  <Input id={key} name={key} defaultValue={property[key]} disabled={!canExecute} />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {(
              [
                ["price", "Price"],
                ["beds", "Beds"],
                ["baths", "Baths"],
                ["sqft", "Sqft"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={key} className="text-xs">
                  {label}
                </Label>
                <Input id={key} name={key} defaultValue={property[key]} disabled={!canExecute} />
              </div>
            ))}
          </div>

          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              More details (description, location, CTA…)
            </summary>
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["propertyType", "Property type"],
                    ["neighborhood", "Neighborhood"],
                    ["city", "City"],
                    ["state", "State"],
                    ["mlsNumber", "MLS number"],
                    ["projectName", "Project name"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={key} className="text-xs">
                      {label}
                    </Label>
                    <Input
                      id={key}
                      name={key}
                      defaultValue={key === "projectName" ? projectName : property[key]}
                      disabled={!canExecute}
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <Label htmlFor="description" className="text-xs">
                  Listing description (the narration only uses facts stated here)
                </Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={3}
                  defaultValue={property.description}
                  disabled={!canExecute}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="callToAction" className="text-xs">
                  Call to action
                </Label>
                <Input
                  id="callToAction"
                  name="callToAction"
                  defaultValue={property.callToAction}
                  placeholder="Book a private tour this weekend"
                  disabled={!canExecute}
                />
              </div>
            </div>
          </details>

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
            <Button type="submit" disabled={pending} variant="outline" className="w-full">
              {pending ? "Saving…" : state.saved ? "Saved ✓ — Save again" : "Save listing details"}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
