// Throwaway research script: find a mainnet wallet holding both SOL and the ZEC
// SPL token, to stand in as the fee payer for a read-only simulateTransaction.
// No key is involved: simulation runs with sigVerify false and spends nothing.
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const rpc = /^SOLANA_RPC_URL=(.*)$/m.exec(env)[1].trim();
const ZEC = "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS";

async function call(method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const largest = await call("getTokenLargestAccounts", [ZEC]);
for (const entry of largest.value.slice(0, 12)) {
  const info = await call("getAccountInfo", [entry.address, { encoding: "jsonParsed" }]);
  const owner = info?.value?.data?.parsed?.info?.owner;
  if (!owner) continue;
  const ownerInfo = await call("getAccountInfo", [owner, { encoding: "base64" }]);
  const sol = (ownerInfo?.value?.lamports ?? 0) / 1e9;
  const isWallet = ownerInfo?.value?.owner === "11111111111111111111111111111111";
  console.log(
    `${owner}  zec=${entry.uiAmountString.padEnd(14)} sol=${sol.toFixed(4).padEnd(12)} systemOwned=${isWallet} ata=${entry.address}`,
  );
}
