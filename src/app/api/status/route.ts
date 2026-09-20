import { processDueJobs } from "@/lib/jobs/processor";
import { statusPayload } from "@/lib/app";
import { fail, ok } from "@/lib/http";

export async function GET() {
  try {
    await processDueJobs();
    return ok(await statusPayload());
  } catch (error) {
    return fail(error instanceof Error ? error.message : "status failed", 500, "internal");
  }
}
