/** Minimal CLI flag parser: --episode 3 --force --note "text" */
export function parseArgs(argv = process.argv.slice(2)): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || !arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export function intArg(
  args: Record<string, string | boolean>,
  key: string,
  fallback?: number,
): number {
  const v = args[key];
  if (v == null || v === true) {
    if (fallback != null) return fallback;
    throw new Error(`Missing required --${key} <number>`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${key} must be a positive integer`);
  return n;
}
