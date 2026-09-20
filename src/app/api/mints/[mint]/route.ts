import { inspectMint } from "@/lib/app";
import { fail, ok } from "@/lib/http";

export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const { mint } = await context.params;
  const owner = new URL(request.url).searchParams.get("owner") ?? undefined;
  try {
    return ok(await inspectMint(mint, owner));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "inspect failed");
  }
}
