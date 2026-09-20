import { quoteLaunch } from "@/lib/app";
import { getPairs } from "@/lib/stonk/client";
import { fail, ok } from "@/lib/http";

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
    if (!body.quoteMint) return fail("quoteMint is required");
    return ok(await quoteLaunch(body.quoteMint));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "quote failed");
  }
}
