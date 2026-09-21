import { hydrateLaunchTx, publicJob } from "@/lib/app";
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
  const recorded = await store.getLaunch(job.mint);
  const launch = recorded ? await hydrateLaunchTx(recorded) : null;
  return ok({
    job: publicJob(job),
    // The stamp being cut already has a name and a face; the job page is where
    // the creator watches it happen, so it says which stamp is being cut.
    collection: launchIdentity(launch),
    claimPackage: job.claimPackage,
  });
}
