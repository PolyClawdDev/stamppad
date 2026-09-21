import { launchView } from "@/lib/app";
import { fail, ok } from "@/lib/http";
import { durabilityProblem } from "@/lib/store/durability";

export async function GET(_request: Request, context: { params: Promise<{ mint: string }> }) {
  const { mint } = await context.params;
  const view = await launchView(mint);
  if (!view) {
    // On a deployment with no database the launch is not missing, it was never
    // kept. Saying so beats sending the operator looking for a lost record.
    const undurable = durabilityProblem();
    return fail(
      undurable
        ? `Launch not found on this protocol instance. ${undurable}`
        : "Launch not found on this protocol instance.",
      404,
      "not_found",
    );
  }
  return ok(view);
}
