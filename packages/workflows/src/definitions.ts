import { z } from "zod";

/**
 * Step config schemas, validated when definitions are created and again when
 * loaded from the DB (Json columns are untyped at rest).
 */

export const agentTaskConfigSchema = z.object({
  agentKey: z.string(),
  goal: z.string(),
  /** Map workflow-run context values into agent input: { agentField: "$.path" } */
  inputMapping: z.record(z.string()).default({}),
});

export const apiCallConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET"),
  headers: z.record(z.string()).default({}),
  bodyTemplate: z.string().optional(),
});

export const codeFunctionConfigSchema = z.object({
  /** Key into the registered function table — never arbitrary code from the DB. */
  functionKey: z.string(),
  args: z.record(z.unknown()).default({}),
});

export const transformConfigSchema = z.object({
  /** { outputField: "$.path.in.context" } */
  mapping: z.record(z.string()),
});

export const fileGenerationConfigSchema = z.object({
  assetName: z.string(),
  assetType: z.enum(["TEXT", "JSON", "DOCUMENT", "WEBSITE"]).default("TEXT"),
  mimeType: z.string().default("text/plain"),
  /** Context path whose value becomes the file content. */
  contentPath: z.string(),
});

export const humanApprovalConfigSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  actionType: z
    .enum([
      "PUBLISH_CONTENT",
      "SEND_EMAIL",
      "DEPLOY_WEBSITE",
      "SPEND_MONEY",
      "EXTERNAL_PURCHASE",
      "DELETE_ASSET",
      "CONTACT_PROSPECT",
      "CHANGE_PRODUCTION_SETTINGS",
      "REVIEW_OUTPUT",
      "OTHER",
    ])
    .default("REVIEW_OUTPUT"),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  /** Context paths surfaced to the reviewer. */
  payloadPaths: z.array(z.string()).default([]),
});

export const delayConfigSchema = z.object({
  delayMs: z
    .number()
    .int()
    .min(0)
    .max(30 * 24 * 3600 * 1000),
});

export const conditionConfigSchema = z.object({
  /** Left side: context path. */
  path: z.string(),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists"]),
  value: z.unknown().optional(),
  /** Step key to jump to when false; omit to continue to next step. */
  elseGoTo: z.string().optional(),
});

export const notificationConfigSchema = z.object({
  kind: z
    .enum([
      "APPROVAL_REQUIRED",
      "WORKFLOW_FAILED",
      "WORKFLOW_COMPLETED",
      "COST_WARNING",
      "COST_LIMIT_REACHED",
      "INTEGRATION_FAILURE",
      "JOB_FAILURE",
      "SYSTEM",
    ])
    .default("SYSTEM"),
  title: z.string(),
  bodyTemplate: z.string().default(""),
});

export const childWorkflowConfigSchema = z.object({
  workflowKey: z.string(),
  inputMapping: z.record(z.string()).default({}),
});

export const publishConfigSchema = z.object({
  /** Publish target key; every target requires approval upstream. */
  target: z.string(),
  payloadPath: z.string().default("$"),
  /** COPPA flag for YouTube uploads — set true only for children's content. */
  madeForKids: z.boolean().default(false),
});

export const STEP_CONFIG_SCHEMAS = {
  AGENT_TASK: agentTaskConfigSchema,
  API_CALL: apiCallConfigSchema,
  CODE_FUNCTION: codeFunctionConfigSchema,
  TRANSFORM: transformConfigSchema,
  FILE_GENERATION: fileGenerationConfigSchema,
  HUMAN_APPROVAL: humanApprovalConfigSchema,
  DELAY: delayConfigSchema,
  CONDITION: conditionConfigSchema,
  NOTIFICATION: notificationConfigSchema,
  CHILD_WORKFLOW: childWorkflowConfigSchema,
  PUBLISH: publishConfigSchema,
} as const;

export type StepTypeKey = keyof typeof STEP_CONFIG_SCHEMAS;

/** Definition used to create a workflow version with steps. */
export const workflowDefinitionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  inputSchema: z.record(z.unknown()),
  costLimitMicroUsd: z.bigint().optional(),
  steps: z.array(
    z.object({
      key: z.string().min(1),
      name: z.string().min(1),
      type: z.enum([
        "AGENT_TASK",
        "API_CALL",
        "CODE_FUNCTION",
        "TRANSFORM",
        "FILE_GENERATION",
        "HUMAN_APPROVAL",
        "DELAY",
        "CONDITION",
        "NOTIFICATION",
        "CHILD_WORKFLOW",
        "PUBLISH",
      ]),
      config: z.record(z.unknown()),
      retryLimit: z.number().int().min(0).max(10).default(2),
      timeoutMs: z.number().int().min(1000).default(300_000),
    }),
  ),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/** Read a "$.a.b" path from the run context. "$" returns the whole context. */
export function readPath(context: Record<string, unknown>, path: string): unknown {
  if (path === "$" || path === "") return context;
  const parts = path.replace(/^\$\.?/, "").split(".");
  let current: unknown = context;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Registered CODE_FUNCTION implementations. Config can only reference keys. */
export type CodeFunction = (
  args: Record<string, unknown>,
  context: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

const codeFunctions = new Map<string, CodeFunction>();

export function registerCodeFunction(key: string, fn: CodeFunction): void {
  codeFunctions.set(key, fn);
}

export function getCodeFunction(key: string): CodeFunction | undefined {
  return codeFunctions.get(key);
}

// Built-in harmless functions.
registerCodeFunction("noop", async () => ({}));
registerCodeFunction("word_count", async (args) => {
  const text = String(args.text ?? "");
  return { wordCount: text.split(/\s+/).filter(Boolean).length };
});
