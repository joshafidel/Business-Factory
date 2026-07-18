"use server";

import { revalidatePath } from "next/cache";
import { createPrompt, rollbackPrompt, updatePrompt } from "@bf/prompts";
import { getProviderRegistry } from "@bf/providers";
import { renderTemplate } from "@bf/prompts";
import { PlatformError, toErrorRecord } from "@bf/shared";
import { z } from "zod";
import { assertPermission } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

const createSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  template: z.string().min(1).max(20_000),
});

export async function createPromptAction(formData: FormData): Promise<{ error?: string }> {
  const ctx = await assertPermission("prompts:write");
  const parsed = createSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    description: (formData.get("description") as string) || undefined,
    template: formData.get("template"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await createPrompt({ organizationId: ctx.organizationId, userId: ctx.userId, ...parsed.data });
  } catch (err) {
    if (err instanceof PlatformError) return { error: toErrorRecord(err).message };
    return { error: "A prompt with that key may already exist." };
  }
  revalidatePath("/prompts");
  return {};
}

const updateSchema = z.object({
  promptId: z.string().min(1),
  template: z.string().min(1).max(20_000),
  changelog: z.string().max(300).optional(),
});

export async function updatePromptAction(formData: FormData): Promise<{ error?: string }> {
  const ctx = await assertPermission("prompts:write");
  const parsed = updateSchema.safeParse({
    promptId: formData.get("promptId"),
    template: formData.get("template"),
    changelog: (formData.get("changelog") as string) || undefined,
  });
  if (!parsed.success) return { error: "Template is required." };
  await updatePrompt({ organizationId: ctx.organizationId, userId: ctx.userId, ...parsed.data });
  revalidatePath(`/prompts/${parsed.data.promptId}`);
  return {};
}

export async function rollbackPromptAction(promptId: string, toVersion: number): Promise<void> {
  const ctx = await assertPermission("prompts:write");
  await rollbackPrompt({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    promptId,
    toVersion,
  });
  revalidatePath(`/prompts/${promptId}`);
}

const testSchema = z.object({
  template: z.string().min(1).max(20_000),
  variables: z.string().max(10_000),
});

/** Test a prompt template against the mock provider (no spend, no side effects). */
export async function testPromptAction(
  formData: FormData,
): Promise<{ error?: string; rendered?: string; output?: string }> {
  const ctx = await assertPermission("prompts:write");
  if (!(await checkRateLimit(`prompt-test:${ctx.userId}`, 20, 60))) {
    return { error: "Rate limit exceeded." };
  }
  const parsed = testSchema.safeParse({
    template: formData.get("template"),
    variables: (formData.get("variables") as string) || "{}",
  });
  if (!parsed.success) return { error: "Template is required." };
  let variables: Record<string, string>;
  try {
    variables = z.record(z.string()).parse(JSON.parse(parsed.data.variables));
  } catch {
    return { error: "Variables must be a JSON object of strings." };
  }
  let rendered: string;
  try {
    rendered = renderTemplate(parsed.data.template, variables);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Render failed" };
  }
  const provider = getProviderRegistry().get("mock");
  const result = await provider.generateText({
    model: "mock-basic",
    messages: [{ role: "user", content: rendered }],
  });
  return { rendered, output: result.text };
}
