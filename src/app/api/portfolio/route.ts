import { fail, ok } from "@/lib/http";
import { portfolio } from "@/lib/market";
import { withStampIdentity } from "@/lib/stamps";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  if (!owner) return fail("owner is required.");
  try {
    const held = await portfolio({ owner, zcashAddress: url.searchParams.get("zcashAddress") });
    return ok({ ...held, stamps: await withStampIdentity(held.stamps) });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "portfolio read failed");
  }
}
