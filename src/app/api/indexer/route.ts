import { fail, ok } from "@/lib/http";
import { indexFromStore } from "@/lib/indexer";

/** Full replay of the derived ledger, so anyone can diff it against their own. */
export async function GET() {
  try {
    const state = await indexFromStore();
    return ok({
      invariants: state.invariants,
      accepted: state.issuance.accepted,
      pendingIssuance: state.issuance.pending,
      rejectedIssuance: state.issuance.rejected,
      ownership: state.ownership,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "index failed", 500, "index_error");
  }
}
