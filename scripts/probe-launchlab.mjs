// Throwaway research script: decode the LaunchLab config accounts Stonk names.
import { PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const rpc = /^SOLANA_RPC_URL=(.*)$/m.exec(env)[1].trim();
const PROGRAM = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
const GLOBAL = new PublicKey("E2fd24QycuwszEK8WyU8CgtCfp5bUkTMenUthzgShJxA");
const PLATFORM = new PublicKey("4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7");
const RULE = new PublicKey("2hu6XQkewEDhx6Ck9GkuMDpRXWWLmHf54ae8Ln6D8PbU");

async function acct(pk) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "getAccountInfo",
      params: [pk.toBase58(), { encoding: "base64" }],
    }),
  });
  const body = await res.json();
  if (!body.result?.value) return null;
  return { owner: body.result.value.owner, lamports: body.result.value.lamports, data: Buffer.from(body.result.value.data[0], "base64") };
}

class R {
  constructor(buf) { this.b = buf; this.o = 8; }
  u8() { return this.b.readUInt8(this.o++); }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  u64() { const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
  u128() { const lo = this.b.readBigUInt64LE(this.o); const hi = this.b.readBigUInt64LE(this.o + 8); this.o += 16; return (hi << 64n) | lo; }
  pk() { const v = new PublicKey(this.b.subarray(this.o, this.o + 32)).toBase58(); this.o += 32; return v; }
  skip(n) { this.o += n; }
  str(n) { const s = this.b.subarray(this.o, this.o + n); this.o += n; return s.toString("utf8").replace(/\0+$/, ""); }
}

// --- derivations
const [authority] = PublicKey.findProgramAddressSync([Buffer.from("vault_auth_seed")], PROGRAM);
const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PROGRAM);
const [ruleDerived] = PublicKey.findProgramAddressSync(
  [Buffer.from("platform_curve_rule"), PLATFORM.toBuffer(), GLOBAL.toBuffer()], PROGRAM);
console.log("vault authority      ", authority.toBase58());
console.log("event authority      ", eventAuthority.toBase58());
console.log("curve rule derived   ", ruleDerived.toBase58(), ruleDerived.equals(RULE) ? "MATCHES Stonk" : "MISMATCH");

// --- global config
const g = await acct(GLOBAL);
console.log("\nglobal_config owner", g.owner, "len", g.data.length);
{
  const r = new R(g.data);
  const out = {
    epoch: r.u64(), curve_type: r.u8(), index: r.u16(), migrate_fee: r.u64(),
    trade_fee_rate: r.u64(), max_share_fee_rate: r.u64(), min_base_supply: r.u64(),
    max_lock_rate: r.u64(), min_base_sell_rate: r.u64(), min_base_migrate_rate: r.u64(),
    min_quote_fund_raising: r.u64(), quote_mint: r.pk(), protocol_fee_owner: r.pk(),
    migrate_fee_owner: r.pk(), migrate_to_amm_wallet: r.pk(), migrate_to_cpswap_wallet: r.pk(),
  };
  console.log(JSON.stringify(out, (k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
}

// --- platform config
const p = await acct(PLATFORM);
console.log("\nplatform_config owner", p.owner, "len", p.data.length);
{
  const r = new R(p.data);
  const out = {
    epoch: r.u64(), platform_fee_wallet: r.pk(), platform_nft_wallet: r.pk(),
    platform_scale: r.u64(), creator_scale: r.u64(), burn_scale: r.u64(), fee_rate: r.u64(),
    name: r.str(64), web: r.str(256), img: r.str(256), cpswap_config: r.pk(),
    creator_fee_rate: r.u64(), transfer_fee_extension_auth: r.pk(),
    platform_vesting_wallet: r.pk(), platform_vesting_scale: r.u64(), platform_cp_creator: r.pk(),
    restrict_global_config: r.u8(), restrict_curve_param: r.u8(), curve_rule_manager: r.pk(),
  };
  console.log(JSON.stringify(out, (k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
}

// --- curve rule
const c = await acct(RULE);
if (!c) console.log("\nplatform_curve_rule: DOES NOT EXIST on chain");
else {
  console.log("\nplatform_curve_rule owner", c.owner, "len", c.data.length);
  const r = new R(c.data);
  const bump = r.u8(), version = r.u8(), pc = r.pk(), gc = r.pk(), epoch = r.u64();
  r.skip(64);
  const groups = r.u32();
  console.log({ bump, version, platform_config: pc, global_config: gc, epoch: epoch.toString(), groupCount: groups });
  for (let i = 0; i < groups; i++) {
    const gid = r.u16(); const ep = r.u64(); const n = r.u32();
    const cons = [];
    for (let j = 0; j < n; j++) cons.push({ field: r.u8(), op: r.u8(), value: r.u128().toString() });
    console.log(" group", gid, "epoch", ep.toString(), "constraints", JSON.stringify(cons));
  }
}

// --- program upgrade info
const prog = await acct(PROGRAM);
console.log("\nprogram account owner", prog.owner, "len", prog.data.length);
