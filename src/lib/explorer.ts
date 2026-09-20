/**
 * Explorer links.
 *
 * Only networks with a real, checkable public explorer get a URL. A ledger that
 * exists solely inside this deployment gets none — a link there would be an
 * invention, not a verification.
 */
export function zcashTxUrl(network: string, txid: string): string | null {
  if (!txid) return null;
  if (network === "zcash:mainnet") return `https://blockchair.com/zcash/transaction/${txid}`;
  return null;
}

export function explorerNote(network: string): string {
  if (network === "zcash:mainnet") return "Opens the transaction on Blockchair.";
  if (network === "zcash:demo") {
    return "This inscription lives on this deployment's own ledger, so there is no public explorer to open.";
  }
  return "No verified public explorer is wired up for this network, so no link is shown.";
}
