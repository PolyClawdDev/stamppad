import { fail, ok } from "@/lib/http";
import { settlementDisclosure, stampWithOwnership } from "@/lib/market";
import { withStampIdentity } from "@/lib/stamps";
import { getStore } from "@/lib/store";
import { provenAddresses } from "@/lib/wallet/taddr-proof";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const store = getStore();
  const stamp = await store.getStamp(id);
  if (!stamp) return fail("Stamp not found.", 404, "not_found");
  const listings = (await store.listListings()).filter((l) => l.stampId === id);
  const [view] = await withStampIdentity([
    // Listability depends on what this session has proved, so this view is
    // specific to the caller rather than a property of the stamp.
    await stampWithOwnership(stamp, undefined, provenAddresses(request)),
  ]);
  return ok({
    ...view,
    listings,
    settlement: settlementDisclosure(),
    validation: { ok: true, reason: "Accepted by stamp-exp/0 against this deployment's ledgers." },
  });
}
