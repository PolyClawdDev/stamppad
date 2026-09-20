import { processDueJobs } from "../lib/jobs/processor";
import { flags } from "../lib/mode";

const intervalMs = Number(process.env.STAMP_WORKER_INTERVAL_MS ?? 2000);

async function tick() {
  try {
    await processDueJobs();
  } catch (error) {
    console.error("[stamp-worker]", error);
  }
}

console.log(`STAMP worker starting mode=${flags().mode} store=${flags().store} interval=${intervalMs}ms`);
void tick();
setInterval(() => void tick(), intervalMs);
