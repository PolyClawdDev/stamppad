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
    };
    if (!body.mint || !body.owner || !body.amountDisplay || !body.destination) {
      return fail("mint, owner, amountDisplay, and destination are required.");
    }
    const job = await convert({
      mint: body.mint,
      owner: body.owner,
      amountDisplay: body.amountDisplay,
      destination: body.destination,
      fail: body.fail,
    });
    return ok({ job: publicJob(job), stampId: job.commitmentHex });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "convert failed");
  }
}
