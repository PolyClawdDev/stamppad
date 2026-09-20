import { fail, ok } from "@/lib/http";
import { portfolio } from "@/lib/market";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  if (!owner) return fail("owner is required.");
  try {
    return ok(
      await portfolio({ owner, zcashAddress: url.searchParams.get("zcashAddress") }),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "portfolio read failed");
  }
}
