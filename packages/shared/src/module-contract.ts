import { z } from "zod";
import { type Permission } from "./rbac";

/**
 * The contract every business module must implement to be installable.
 * The core platform only ever interacts with modules through this interface;
 * it never imports business logic directly.
 */

export const MODULE_STATUSES = ["COMING_NEXT", "NOT_INSTALLED", "INSTALLED", "DISABLED"] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];

export interface MetricDescriptor {
  key: string;
  label: string;
  unit: "count" | "usd" | "seconds" | "percent";
  description?: string;
}

export interface WidgetDescriptor {
  key: string;
  title: string;
  /** Widget kind the dashboard knows how to render generically. */
  kind: "stat" | "list" | "chart";
}

export interface WorkflowBlueprint {
  key: string;
  name: string;
  description: string;
}

export interface AgentBlueprint {
  key: string;
  name: string;
  role: string;
  description: string;
}

export interface ModuleContract {
  /** Stable machine key, e.g. "kids-shorts". */
  key: string;
  name: string;
  description: string;
  workflows: WorkflowBlueprint[];
  agents: AgentBlueprint[];
  /** Integration keys this module needs before it can be installed. */
  requiredIntegrations: string[];
  requiredPermissions: Permission[];
  dashboard: {
    navLabel: string;
    widgets: WidgetDescriptor[];
  };
  metrics: MetricDescriptor[];
  /** Module settings, validated on install/update. */
  configSchema: z.ZodTypeAny;
}

/** Serializable form stored on the BusinessModule DB row. */
export const moduleManifestSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  workflows: z.array(z.object({ key: z.string(), name: z.string(), description: z.string() })),
  agents: z.array(
    z.object({ key: z.string(), name: z.string(), role: z.string(), description: z.string() }),
  ),
  requiredIntegrations: z.array(z.string()),
  requiredPermissions: z.array(z.string()),
  dashboard: z.object({
    navLabel: z.string(),
    widgets: z.array(
      z.object({ key: z.string(), title: z.string(), kind: z.enum(["stat", "list", "chart"]) }),
    ),
  }),
  metrics: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      unit: z.enum(["count", "usd", "seconds", "percent"]),
      description: z.string().optional(),
    }),
  ),
  /** JSON Schema (not Zod) so it can live in the DB. */
  configSchema: z.record(z.unknown()),
});
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
