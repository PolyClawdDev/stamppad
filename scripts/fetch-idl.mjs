// Throwaway research script: pull the Anchor IDL account for a program.
import { PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { inflate } from "node:zlib";
import { promisify } from "node:util";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const rpc = /^SOLANA_RPC_URL=(.*)$/m.exec(env)[1].trim();
const programId = new PublicKey(process.argv[2]);

const [base] = PublicKey.findProgramAddressSync([], programId);
const idlAddress = await PublicKey.createWithSeed(base, "anchor:idl", programId);
console.log("idl account", idlAddress.toBase58());

const res = await fetch(rpc, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getAccountInfo",
    params: [idlAddress.toBase58(), { encoding: "base64" }],
  }),
});
const body = await res.json();
if (!body.result?.value) {
  console.log("no IDL account on chain", JSON.stringify(body).slice(0, 300));
  process.exit(0);
}
const data = Buffer.from(body.result.value.data[0], "base64");
// 8 discriminator + 32 authority + 4 len
const len = data.readUInt32LE(40);
const compressed = data.subarray(44, 44 + len);
const json = await promisify(inflate)(compressed);
console.log(json.toString("utf8"));
