import { fail, ok } from "@/lib/http";
import { indexFromStore } from "@/lib/indexer";
import { stampWithOwnership } from "@/lib/market";
import { withStampIdentity } from "@/lib/stamps";
import { getStore } from "@/lib/store";

export async function GET() {
  try {
    const [stamps, state] = await Promise.all([getStore().listStamps(), indexFromStore()]);
    return ok({
      stamps: await withStampIdentity(
        await Promise.all(stamps.map((s) => stampWithOwnership(s, state))),
      ),
      invariants: state.invariants,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "stamp list failed", 500, "index_error");
  }
}
