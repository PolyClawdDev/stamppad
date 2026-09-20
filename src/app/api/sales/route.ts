import { fail, ok } from "@/lib/http";
import { saleHistory } from "@/lib/sales";

/**
 * Completed sales only. `mint` scopes to one collection, `stamp` to one
 * inscription; both filters run over the same indexer-derived list.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mint = url.searchParams.get("mint");
    const stamp = url.searchParams.get("stamp");
    const history = await saleHistory();
    const sales = history.sales.filter(
      (s) => (!mint || s.mint === mint) && (!stamp || s.stampId === stamp),
    );
    return ok({ ...history, sales });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "sale history failed", 500, "index_error");
  }
}
