/**
 * Builds a real mainnet launch for the caller's wallet to approve.
 *
 * Returns an unsigned transaction and the mainnet simulation that proves it.
 * This route cannot send anything and holds no key, so a response from it has
 * moved nothing: the creator signs in their own wallet or nothing happens.
 */
import { prepareMainnetLaunch } from "@/lib/app";
import { artworkProblem } from "@/lib/artwork";
import { fail, ok } from "@/lib/http";
import { ZEC_QUOTE_MINT } from "@/lib/protocol";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      owner?: string;
      name?: string;
      symbol?: string;
      description?: string;
      imageDataUrl?: string | null;
      quoteMint?: string;
      quoteAmountDisplay?: string;
    };
    if (!body.owner || !body.name || !body.symbol || !body.quoteAmountDisplay) {
      return fail("owner, name, symbol, and quoteAmountDisplay are required.");
    }
    if (body.name.length > 32) return fail("Name is limited to 32 characters.");
    if (body.symbol.length > 10) return fail("Symbol is limited to 10 characters.");
    const artwork = artworkProblem(body.imageDataUrl);
    if (artwork) return fail(artwork);
    return ok(
      await prepareMainnetLaunch({
        owner: body.owner,
        name: body.name,
        symbol: body.symbol,
        description: body.description ?? "",
        imageDataUrl: body.imageDataUrl ?? null,
        quoteMint: body.quoteMint || ZEC_QUOTE_MINT,
        quoteAmountDisplay: body.quoteAmountDisplay,
      }),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "preparing the launch failed");
  }
}
