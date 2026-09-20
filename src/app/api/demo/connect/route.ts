import { ensureDemoWallet } from "@/lib/app";
import { fail, ok } from "@/lib/http";
import { stampMode } from "@/lib/mode";

export async function POST(request: Request) {
  if (stampMode() !== "demo") return fail("Demo wallet airdrop is only available in demo mode.", 403, "forbidden");
  try {
    const body = (await request.json()) as { owner?: string };
    if (!body.owner) return fail("owner public key is required");
    return ok(await ensureDemoWallet(body.owner));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "connect failed");
  }
}
