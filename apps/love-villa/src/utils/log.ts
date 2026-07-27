/** Tiny console logger with consistent prefixes (no dependency). */

export const log = {
  info(msg: string): void {
    console.log(`  ${msg}`);
  },
  step(msg: string): void {
    console.log(`\n▸ ${msg}`);
  },
  ok(msg: string): void {
    console.log(`✓ ${msg}`);
  },
  warn(msg: string): void {
    console.warn(`⚠ ${msg}`);
  },
  error(msg: string): void {
    console.error(`✗ ${msg}`);
  },
};
