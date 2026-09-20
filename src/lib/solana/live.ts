import { flags, liveMoneyMovementBlocked } from "../mode";

/** Read-only / gated live Solana adapter. Never silently falls back to demo success. */
export async function assertLiveBurnsAllowed(): Promise<void> {
  const blocked = liveMoneyMovementBlocked("burn");
  if (blocked) throw new Error(blocked);
  if (!flags().solanaRpc) throw new Error("SOLANA_RPC_URL is required for live burns.");
}

export async function assertLiveLaunchAllowed(): Promise<void> {
  const blocked = liveMoneyMovementBlocked("launch");
  if (blocked) throw new Error(blocked);
  if (!flags().solanaRpc) throw new Error("SOLANA_RPC_URL is required for live LaunchLab construction.");
}
