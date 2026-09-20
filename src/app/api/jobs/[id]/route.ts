import { publicJob } from "@/lib/app";
import { fail, ok } from "@/lib/http";
import { processDueJobs } from "@/lib/jobs/processor";
import { getStore } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await processDueJobs();
  const { id } = await context.params;
  const job = await getStore().getJob(id);
  if (!job) return fail("Job not found.", 404, "not_found");
  return ok({ job: publicJob(job), claimPackage: job.claimPackage });
}
