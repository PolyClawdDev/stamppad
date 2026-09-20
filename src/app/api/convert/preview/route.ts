import { previewConvert } from "@/lib/app";
import { fail, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mint?: string;
      owner?: string;
      amountDisplay?: string;
      destination?: string;
    };
    if (!body.mint || !body.owner || !body.amountDisplay || !body.destination) {
      return fail("mint, owner, amountDisplay, and destination are required.");
    }
    return ok(
      await previewConvert({
        mint: body.mint,
        owner: body.owner,
        amountDisplay: body.amountDisplay,
        destination: body.destination,
      }),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "preview failed");
  }
}
