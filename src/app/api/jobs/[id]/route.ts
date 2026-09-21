import { publicJob } from "@/lib/app";
import { fail, ok } from "@/lib/http";
import { processDueJobs } from "@/lib/jobs/processor";
import { launchIdentity } from "@/lib/stamps";
import { getStore } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await processDueJobs();
  const { id } = await context.params;
  const store = getStore();
  const job = await store.getJob(id);
  if (!job) return fail("Job not found.", 404, "not_found");
  return ok({
    job: publicJob(job),
    // The stamp being cut already has a name and a face; the job page is where
    // the creator watches it happen, so it says which stamp is being cut.
    collection: launchIdentity(await store.getLaunch(job.mint)),
    claimPackage: job.claimPackage,
  });
}
