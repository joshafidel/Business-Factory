import { cleanQueues, getRedis } from "@bf/queue";

/** pnpm queue:clean — remove completed/failed jobs from all queues. */
async function main(): Promise<void> {
  await cleanQueues();
  // eslint-disable-next-line no-console
  console.log("Queues cleaned.");
  await getRedis().quit();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
