import { recordLaunchTx } from "@/lib/app";
import { fail, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { mint?: string; launchTx?: string };
    if (!body.mint || !body.launchTx) return fail("mint and launchTx are required.");
    await recordLaunchTx(body.mint, body.launchTx);
    return ok({ mint: body.mint, launchTx: body.launchTx });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "confirming the launch failed");
  }
}
