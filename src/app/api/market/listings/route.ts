import { fail, ok } from "@/lib/http";
import { createListing } from "@/lib/market";
import { readSessionCookie } from "@/lib/wallet/cookie";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      stampId?: string;
      sellerAddress?: string;
      sellerPublicKeyHex?: string;
      priceZat?: string;
      note?: string;
    };
    if (!body.stampId || !body.sellerAddress || !body.priceZat) {
      return fail("stampId, sellerAddress, and priceZat are required.");
    }
    return ok(
      await createListing({
        stampId: body.stampId,
        sellerAddress: body.sellerAddress,
        sellerPublicKeyHex: body.sellerPublicKeyHex,
        priceZat: body.priceZat,
        note: body.note,
        // A transparent seller's key comes from a control proof held against
        // this session, not from anything the request claims.
        session: readSessionCookie(request),
      }),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "listing failed");
  }
}
