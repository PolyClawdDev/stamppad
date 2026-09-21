/**
 * Proves the launch and burn builders against Solana mainnet, spending nothing.
 *
 * simulateTransaction runs the transaction through the real bank against real
 * account state, so it catches a wrong PDA, a wrong account order, a wrong
 * discriminator, or a mis-encoded argument. It verifies no signatures and
 * commits nothing, which is why it can be run against a wallet whose key
 * nobody here has.
 *
 * The creator is therefore a real mainnet wallet chosen only because it holds
 * both SOL and ZEC. Nothing is signed on its behalf and nothing is sent. Pass
 * a different one with --creator to check your own.
 *
 *   npx tsx --env-file=.env.local scripts/simulate-mainnet.ts
 */
import { prepareLiveLaunch } from "../src/lib/solana/live-launch";
import { prepareLiveBurn } from "../src/lib/solana/live-burn";
import { SolanaRpc } from "../src/lib/solana/rpc";

const ZEC_MINT = "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

// Live reads are required to build against the venue's current numbers. This
// script never sends, so it enables them for itself rather than asking the
// operator to turn on live money movement to run a simulation.
process.env.STAMP_STONK_READ_LIVE = "true";

const creator = arg("creator", "ByiAbN9MJhfQKGK5WJrfgko6XS88qqERQVRLWZTsvyTf");
const destination = arg("destination", "t1P2GcxGhzeM5tPk3r3JsGh1tEVArD4C2fB");
const quoteAmount = BigInt(arg("quote", "1000000")); // 0.01 ZEC at 8 decimals

function report(label: string, simulation: { ok: boolean; err: unknown; logs: string[]; unitsConsumed: number | null; programError: { code: number; name: string | null } | null }) {
  console.log(`\n--- ${label} simulation ---`);
  console.log("ok:", simulation.ok);
  console.log("err:", JSON.stringify(simulation.err));
  if (simulation.programError) {
    console.log(
      "program error:",
      simulation.programError.code,
      simulation.programError.name ?? "(unmapped)",
    );
  }
  console.log("compute units:", simulation.unitsConsumed);
  console.log("logs:");
  for (const line of simulation.logs) console.log("  " + line);
}

async function main() {
  const rpc = new SolanaRpc(process.env.SOLANA_RPC_URL ?? "");
  console.log("mainnet slot:", await rpc.getSlot());
  console.log("creator (simulation stand-in, never signed for):", creator);

  console.log("\n=== 1. LaunchLab launch, ZEC-paired, with the creator's dev buy ===");
  const launch = await prepareLiveLaunch({
    creator,
    name: "StampPad Proof",
    symbol: "SPPROOF",
    metadataUriTemplate: "https://stamppad.xyz/api/launches/{mint}/metadata",
    quoteMint: ZEC_MINT,
    quoteAmountIn: quoteAmount,
  });
  console.log("mint:", launch.mint);
  console.log("pool:", launch.pool);
  console.log("pricing source:", launch.pricingSource);
  console.log("curve:", JSON.stringify(launch.curve, null, 2));
  console.log("quote in:", launch.quote.amountIn, launch.quote.symbol);
  console.log("allocation:", JSON.stringify(launch.allocation, null, 2));
  console.log("fees:", JSON.stringify(launch.fees, null, 2));
  console.log("costs:", JSON.stringify(launch.costs, null, 2));
  console.log("tx bytes:", Buffer.from(launch.transactionBase64, "base64").length);
  console.log("awaiting signature from:", launch.awaitingSignatureFrom.join(", "));
  report("launch", launch.simulation);

  console.log("\n=== 2. Burn of a whole allocation, with the destination memo ===");
  const burnMint = arg("burnMint", "");
  const burnAuthority = arg("burnAuthority", "");
  if (!burnMint || !burnAuthority) {
    console.log(
      "skipped: pass --burnMint= and --burnAuthority= for a wallet that holds a\n" +
        "balance of that mint. A freshly launched mint cannot be burned in simulation\n" +
        "because the allocation does not exist until the launch is actually sent.",
    );
    return;
  }
  const burn = await prepareLiveBurn({
    mint: burnMint,
    authority: burnAuthority,
    destination,
  });
  console.log("mint:", burn.mint, "program:", burn.tokenProgram);
  console.log("token account:", burn.tokenAccount);
  console.log("amount base:", burn.amountBase, "decimals:", burn.decimals);
  console.log("memo:", JSON.stringify(burn.memo));
  console.log("stamp rule:", JSON.stringify(burn.stampRule));
  console.log("costs:", JSON.stringify(burn.costs));
  report("burn", burn.simulation);
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
