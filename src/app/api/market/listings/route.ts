import { fail, ok } from "@/lib/http";
import { createListing } from "@/lib/market";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      stampId?: string;
      sellerAddress?: string;
      sellerPublicKeyHex?: string;
      priceZat?: string;
      note?: string;
    };
    if (!body.stampId || !body.sellerAddress || !body.sellerPublicKeyHex || !body.priceZat) {
      return fail("stampId, sellerAddress, sellerPublicKeyHex, and priceZat are required.");
    }
    return ok(
      await createListing({
        stampId: body.stampId,
        sellerAddress: body.sellerAddress,
        sellerPublicKeyHex: body.sellerPublicKeyHex,
        priceZat: body.priceZat,
        note: body.note,
      }),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "listing failed");
  }
}
