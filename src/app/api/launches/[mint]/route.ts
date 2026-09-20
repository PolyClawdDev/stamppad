import { launchView } from "@/lib/app";
import { fail, ok } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ mint: string }> }) {
  const { mint } = await context.params;
  const view = await launchView(mint);
  if (!view) return fail("Launch not found on this protocol instance.", 404, "not_found");
  return ok(view);
}
