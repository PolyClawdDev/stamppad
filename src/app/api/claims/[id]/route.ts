import { fail, ok } from "@/lib/http";
import { getStore } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = await getStore().getJob(id);
  if (!job?.claimPackage) return fail("No exportable claim package for that job.", 404, "not_found");
  return ok(job.claimPackage);
}
