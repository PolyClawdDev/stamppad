import { fail, ok } from "@/lib/http";
import { advanceListing, listingChallenge, publicListing, reserveListing } from "@/lib/market";
import { getStore } from "@/lib/store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  try {
    if (url.searchParams.get("challenge") === "true") {
      return ok(await listingChallenge(id));
    }
    const listing = await getStore().getListing(id);
    if (!listing) return fail("Listing not found.", 404, "not_found");
    return ok(publicListing(listing));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "listing read failed");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      action?: string;
      buyerAddress?: string;
      buyerPublicKeyHex?: string;
      signatureHex?: string;
      publicKeyHex?: string;
    };
    if (body.action === "reserve") {
      if (!body.buyerAddress || !body.buyerPublicKeyHex) {
        return fail("buyerAddress and buyerPublicKeyHex are required to reserve.");
      }
      return ok(
        await reserveListing({
          listingId: id,
          buyerAddress: body.buyerAddress,
          buyerPublicKeyHex: body.buyerPublicKeyHex,
        }),
      );
    }
    const actions = [
      "publishOffer",
      "authorize",
      "lockPayment",
      "publishTransfer",
      "claimPayment",
      "cancel",
    ] as const;
    const action = actions.find((a) => a === body.action);
    if (!action) return fail(`action must be one of reserve, ${actions.join(", ")}.`);
    return ok(
      await advanceListing({
        listingId: id,
        action,
        signatureHex: body.signatureHex,
        publicKeyHex: body.publicKeyHex,
      }),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "listing action failed");
  }
}
