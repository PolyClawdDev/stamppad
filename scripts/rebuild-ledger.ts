/**
 * Independent ledger rebuild. Replays issuance and ownership from chain data
 * plus published authorization artifacts, twice, and fails if the two runs
 * differ. Nothing is read from app-managed listing state.
 */
import { writeFileSync } from "node:fs";
import { indexFromStore } from "../src/lib/indexer";

async function main() {
  const first = await indexFromStore();
  const second = await indexFromStore();

  const a = `${JSON.stringify(first, null, 2)}\n`;
  const b = `${JSON.stringify(second, null, 2)}\n`;
  if (a !== b) {
    console.error("Independent rebuilds diverged.");
    process.exit(1);
  }

  writeFileSync("ledger-rebuild.json", a);
  const owners = Object.values(first.ownership.stamps);
  console.log(
    `Rebuilt ${first.issuance.accepted.length} accepted issuances, ${owners.reduce(
      (n, s) => n + s.history.length,
      0,
    )} ownership transfers, ${first.ownership.sales.length} confirmed sales. Byte-identical across two runs.`,
  );
  console.log(
    `Invariants: chains contiguous=${first.invariants.ownershipChainsContiguous}, conflicting sales=${first.invariants.conflictingSales}, unresolved records=${first.invariants.unresolvedRecords}`,
  );
  console.log("Wrote ledger-rebuild.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
