import { convert, publicJob } from "@/lib/app";
import { fail, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mint?: string;
      owner?: string;
      amountDisplay?: string;
      destination?: string;
      fail?: boolean;
      sourceTx?: string;
      amountBase?: string;
      decimals?: number;
    };
    if (!body.mint || !body.owner || !body.destination) {
      return fail("mint, owner, and destination are required.");
    }
    if (!body.amountDisplay && !body.amountBase) {
      return fail("amountDisplay or amountBase is required.");
    }
    const job = await convert({
      mint: body.mint,
      owner: body.owner,
      amountDisplay: body.amountDisplay ?? "0",
      destination: body.destination,
      fail: body.fail,
      sourceTx: body.sourceTx,
      amountBase: body.amountBase,
      decimals: body.decimals,
    });
    return ok({ job: publicJob(job), stampId: job.commitmentHex });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "convert failed");
  }
}
