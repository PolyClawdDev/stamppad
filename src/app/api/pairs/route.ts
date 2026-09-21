import { quoteLaunch } from "@/lib/app";
import { fail, ok } from "@/lib/http";
import { NATIVE_MINT } from "@/lib/protocol";
import { getPairs } from "@/lib/stonk/client";

export async function GET() {
  try {
    return ok(await getPairs());
  } catch (error) {
    return fail(error instanceof Error ? error.message : "pairs failed", 502, "upstream");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { quoteMint?: string };
    return ok(await quoteLaunch(body.quoteMint || NATIVE_MINT));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "quote failed");
  }
}
