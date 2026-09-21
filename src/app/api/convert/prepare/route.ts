/**
 * Builds a real mainnet burn for the caller's wallet to approve.
 *
 * The burn and the destination memo are one transaction, because a burn without
 * the memo is a burn no stamp can ever claim. Returns unsigned, with the
 * mainnet simulation and the stamp rule checked against it.
 */
import { prepareMainnetBurn } from "@/lib/app";
import { fail, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mint?: string;
      owner?: string;
      destination?: string;
      amountDisplay?: string;
    };
    if (!body.mint || !body.owner || !body.destination) {
      return fail("mint, owner, and destination are required.");
    }
    return ok(
      await prepareMainnetBurn({
        mint: body.mint,
        owner: body.owner,
        destination: body.destination,
        amountDisplay: body.amountDisplay,
      }),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "preparing the burn failed");
  }
}
