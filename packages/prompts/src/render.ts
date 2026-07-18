/**
 * Prompt templates use {{variable}} placeholders. Rendering is strict:
 * unknown placeholders left in the template are an error, so a typo cannot
 * silently ship a literal "{{topic}}" to a model.
 */
export function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g);
  return [...new Set([...matches].map((m) => m[1] as string))];
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      throw new Error(`Prompt variable "${name}" was not provided`);
    }
    return value;
  });
  return rendered;
}
