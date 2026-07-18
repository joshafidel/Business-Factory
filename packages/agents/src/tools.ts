import { prisma } from "@bf/database";
import { PlatformError } from "@bf/shared";

/**
 * Tool permission checks. An agent may call a tool only when:
 *  - the tool exists, is enabled, and is not on the agent's forbidden list
 *  - it is on the agent's allowed list (empty list = no tools)
 *  - no explicit ToolPermission row denies it
 */
export async function assertToolAllowed(params: {
  organizationId: string;
  agentKey: string;
  toolKey: string;
  allowedTools: string[];
  forbiddenTools: string[];
}): Promise<void> {
  const { toolKey } = params;
  if (params.forbiddenTools.includes(toolKey)) {
    throw new PlatformError("TOOL_FORBIDDEN", `Tool "${toolKey}" is forbidden for this agent`);
  }
  if (!params.allowedTools.includes(toolKey)) {
    throw new PlatformError("TOOL_FORBIDDEN", `Tool "${toolKey}" is not in the agent's allowlist`);
  }
  const tool = await prisma.tool.findFirst({
    where: { organizationId: params.organizationId, key: toolKey },
    include: { permissions: { where: { agentKey: params.agentKey } } },
  });
  if (!tool || !tool.isEnabled) {
    throw new PlatformError("TOOL_FORBIDDEN", `Tool "${toolKey}" does not exist or is disabled`);
  }
  const explicit = tool.permissions[0];
  if (explicit && !explicit.isAllowed) {
    throw new PlatformError(
      "TOOL_FORBIDDEN",
      `Tool "${toolKey}" is explicitly denied for agent "${params.agentKey}"`,
    );
  }
}

/** Validate an agent version's tool lists against the org's tool registry. */
export async function validateToolLists(params: {
  organizationId: string;
  allowedTools: string[];
}): Promise<string[]> {
  if (params.allowedTools.length === 0) return [];
  const tools = await prisma.tool.findMany({
    where: { organizationId: params.organizationId, key: { in: params.allowedTools } },
    select: { key: true },
  });
  const known = new Set(tools.map((t) => t.key));
  return params.allowedTools.filter((k) => !known.has(k));
}
