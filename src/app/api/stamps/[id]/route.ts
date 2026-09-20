import { fail, ok } from "@/lib/http";
import { settlementDisclosure, stampWithOwnership } from "@/lib/market";
import { getStore } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const store = getStore();
  const stamp = await store.getStamp(id);
  if (!stamp) return fail("Stamp not found.", 404, "not_found");
  const listings = (await store.listListings()).filter((l) => l.stampId === id);
  return ok({
    ...(await stampWithOwnership(stamp)),
    listings,
    settlement: settlementDisclosure(),
    validation: { ok: true, reason: "Accepted by stamp-exp/0 against the demo ledgers." },
  });
}
