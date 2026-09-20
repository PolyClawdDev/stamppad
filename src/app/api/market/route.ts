import { fail, ok } from "@/lib/http";
import { marketOverview } from "@/lib/market";

export async function GET() {
  try {
    return ok(await marketOverview());
  } catch (error) {
    return fail(error instanceof Error ? error.message : "market read failed", 500, "market_error");
  }
}
