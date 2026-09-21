import { quoteLaunch } from "@/lib/app";
import { fail, ok } from "@/lib/http";
import { NATIVE_MINT } from "@/lib/protocol";
import { readQuoteHeld } from "@/lib/solana/live-launch";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { owner?: string; quoteMint?: string };
    if (!body.owner) return fail("owner is required.");
    const quoteMint = body.quoteMint || NATIVE_MINT;
    const quote = await quoteLaunch(quoteMint);
    const amountBase = await readQuoteHeld({
      owner: body.owner,
      quoteMint,
      tokenProgram: quote.pricing.quote.tokenProgram,
    });
    return ok({
      mint: quoteMint,
      symbol: quote.pair.symbol,
      decimals: quote.pricing.quote.decimals,
      amountBase: amountBase.toString(10),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "quote balance failed");
  }
}
