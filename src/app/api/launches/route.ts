import { createDemoLaunch } from "@/lib/app";
import { fail, ok } from "@/lib/http";
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
      quoteMint?: string;
      buyDisplay?: string;
      convertDisplay?: string;
    };
    if (!body.owner || !body.name || !body.symbol || !body.quoteMint) {
      return fail("owner, name, symbol, and quoteMint are required.");
    }
    if (body.name.length > 32) return fail("Name is limited to 32 characters (Stonk metadata limit).");
    if (body.symbol.length > 10) return fail("Symbol is limited to 10 characters.");
    return ok(
      await createDemoLaunch({
        owner: body.owner,
        name: body.name,
        symbol: body.symbol,
        description: body.description ?? "",
        imageDataUrl: body.imageDataUrl ?? null,
        quoteMint: body.quoteMint,
        buyDisplay: body.buyDisplay,
        convertDisplay: body.convertDisplay,
      }),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "launch failed");
  }
}
