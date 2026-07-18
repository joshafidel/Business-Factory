import { z } from "zod";

/** JSON-safe value schema for validating things headed into Json DB columns. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

/**
 * Validate data against a JSON Schema subset (type/properties/required/enum/items).
 * Agents store their input/output schemas as JSON Schema in the DB; this gives us
 * runtime validation without pulling a full ajv dependency into every consumer.
 * Deliberately supports the pragmatic subset our agents use.
 */
export function validateJsonSchema(
  schema: Record<string, unknown>,
  data: unknown,
  path = "$",
): string[] {
  const errors: string[] = [];
  const type = schema.type as string | undefined;

  if (type === "object") {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return [`${path}: expected object`];
    }
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema.required ?? []) as string[];
    for (const key of required) {
      if (!(key in (data as Record<string, unknown>))) {
        errors.push(`${path}.${key}: required`);
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        errors.push(...validateJsonSchema(sub, value, `${path}.${key}`));
      }
    }
  } else if (type === "array") {
    if (!Array.isArray(data)) return [`${path}: expected array`];
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      data.forEach((item, i) => errors.push(...validateJsonSchema(items, item, `${path}[${i}]`)));
    }
    const minItems = schema.minItems as number | undefined;
    if (minItems !== undefined && data.length < minItems) {
      errors.push(`${path}: expected at least ${minItems} items`);
    }
  } else if (type === "string") {
    if (typeof data !== "string") return [`${path}: expected string`];
    const enumVals = schema.enum as string[] | undefined;
    if (enumVals && !enumVals.includes(data)) {
      errors.push(`${path}: must be one of ${enumVals.join(", ")}`);
    }
    const minLength = schema.minLength as number | undefined;
    if (minLength !== undefined && data.length < minLength) {
      errors.push(`${path}: shorter than minLength ${minLength}`);
    }
  } else if (type === "number" || type === "integer") {
    if (typeof data !== "number") return [`${path}: expected number`];
    if (type === "integer" && !Number.isInteger(data)) errors.push(`${path}: expected integer`);
    const min = schema.minimum as number | undefined;
    const max = schema.maximum as number | undefined;
    if (min !== undefined && data < min) errors.push(`${path}: below minimum ${min}`);
    if (max !== undefined && data > max) errors.push(`${path}: above maximum ${max}`);
  } else if (type === "boolean") {
    if (typeof data !== "boolean") return [`${path}: expected boolean`];
  }
  return errors;
}
