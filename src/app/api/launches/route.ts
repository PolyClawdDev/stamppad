import { createDemoLaunch } from "@/lib/app";
import { artworkProblem } from "@/lib/artwork";
import { fail, ok } from "@/lib/http";
import { ZEC_QUOTE_MINT } from "@/lib/protocol";
import { getStore } from "@/lib/store";

export async function GET() {
  const launches = await getStore().listLaunches();
  return ok({ launches });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      owner?: string;
      name?: string;
      symbol?: string;
      description?: string;
      imageDataUrl?: string | null;
      website?: string;
      twitter?: string;
      telegram?: string;
      quoteMint?: string;
      buyDisplay?: string;
      convertDisplay?: string;
    };
    if (!body.owner || !body.name || !body.symbol) {
      return fail("owner, name, and symbol are required.");
    }
    if (body.name.length > 32) return fail("Name is limited to 32 characters (Stonk metadata limit).");
    if (body.symbol.length > 10) return fail("Symbol is limited to 10 characters.");
    const artwork = artworkProblem(body.imageDataUrl);
    if (artwork) return fail(artwork);
    return ok(
      await createDemoLaunch({
        owner: body.owner,
        name: body.name,
        symbol: body.symbol,
        description: body.description ?? "",
        imageDataUrl: body.imageDataUrl ?? null,
        website: body.website,
        twitter: body.twitter,
        telegram: body.telegram,
        quoteMint: body.quoteMint || ZEC_QUOTE_MINT,
        buyDisplay: body.buyDisplay,
        convertDisplay: body.convertDisplay,
      }),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "launch failed");
  }
}
