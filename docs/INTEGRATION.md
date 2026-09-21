# Integration findings

Retrieved 2026-09-20. Live HTTP probes used `https://www.stonkfun.xyz`. This file records what was verified. It does not invent endpoints.

STAMP is not affiliated with Stonk, Raydium, Solana, Zcash, or their developers. Third-party pages are concept or vendor references, not a STAMP specification.

## Stonk (stonkfun.xyz)

Sources:

- https://www.stonkfun.xyz/developers (retrieved 2026-09-20)
- https://www.stonkfun.xyz/api/public/v1/openapi.json (retrieved 2026-09-20)
- Live `GET /stats`, `GET /pairs?launchable=true`, `GET /launchlab/pricing` (2026-09-20)
- Live `POST /launches/prepare` (2026-09-20)

### Verified

| Item | Result | Date |
| --- | --- | --- |
| Public API base | `https://www.stonkfun.xyz/api/public/v1` | 2026-09-20 |
| Auth | No API key. Launch authorization is a local wallet signature. Never send a private key. | 2026-09-20 |
| Envelope | Success `{ data, meta }`. Failure `{ error: { code, message } }` | 2026-09-20 |
| `GET /stats` | Live. `network` was `mainnet-beta`. `config.paidLaunchesEnabled=false`, `launchLabEnabled=true`, `devBuysEnabled=true`, `apiLaunchesEnabled=true` | 2026-09-20 |
| `GET /pairs` | Live. Fields: `mint`, `symbol`, `name`, `decimals`, `logoUrl`, `category`, `categoryLabel`, `tokenProgram`, `launchable`, `symbolAmbiguous`, `launchLabReady` | 2026-09-20 |
| `GET /launchlab/pricing?quoteMint=` | Live. See schema below. | 2026-09-20 |
| `POST /launches/prepare` | HTTP 503 `service_unavailable`: "New launches on this venue are disabled; launch through LaunchLab instead" | 2026-09-20 |
| OpenAPI launch writes | Official OpenAPI lists **no** `POST /launches/prepare` or `POST /launches/submit`. Write launch paths in OpenAPI are fee-claim only. | 2026-09-20 |
| `GET /tokens` | Documented. Live list call returned HTTP 500 HTML on 2026-09-20 from this environment; do not invent a token list schema beyond documented query params. | 2026-09-20 |

Documented read paths that were not fully schema-validated beyond OpenAPI's generic `{data,meta}`:

- `GET /tokens`, `GET /tokens/{mint}`
- `GET /tokens/{mint}/burns|rewards|airdrop|backing|fees`
- `GET /launches`, `GET /launches/{paymentSignature}`
- `GET /rewards`, `GET /revenue`, `GET /revenue/history`
- `GET /api/public/total-assets` (outside the versioned base)

### Launch path that is actually enabled

`paidLaunchesEnabled=false` and `POST /launches/prepare` is disabled. The documented working construction path is:

1. `GET /pairs?launchable=true&launchLabReady=true`
2. `GET /launchlab/pricing?quoteMint={mint}`
3. Build `initializeWithToken2022` against Raydium LaunchLab yourself
4. Sign locally with the creator wallet **and** a new mint keypair
5. Send the transaction yourself
6. Watch `GET /tokens/{mint}` for `launchpad: "launchlab"` adoption

There is no `paymentSignature` on this path. A LaunchLab launch is not a later trade. Optional initial purchase is a separate `buy_exact_in` the creator may append; STAMP must not assume the prepare/submit API executes it.

### LaunchLab pricing schema (live sample, 2026-09-20)

Quote mint probed: `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` (SPYX).

- `quote.mint|symbol|decimals|tokenProgram`
- `raise.raw` — integer string in quote decimals. Use this, not the Raydium SDK 85 SOL constant.
- `curve.programId` = `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`
- `curve.configId`, `curveType=ConstantCurve`, `migrateType=cpmm`
- `curve.baseDecimals=6` — LaunchLab base mints are 6 decimals
- `curve.supply="1000000000000000"` (1_000_000_000 display tokens)
- `curve.totalSellA="793100000000000"`
- `curve.derived.virtualA|virtualB`
- `platform.standard` = `4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7`
- `platform.reward` = `6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt`
- `curveRule.standard|reward` — last initialize account, read-only
- `modes.standard.transferFee=null`
- `modes.reward.transferFeeBps=[100,300]`

These platform ids are Stonk's published identifiers, captured from their pricing API. Publishing them is not an affiliation.

### What STAMP must not do

- Invent `POST /launches/*` as a working write API.
- Offer arbitrary supply, decimals, or curve constants when LaunchLab+Stonk fix them.
- Treat pool inventory as the creator's burnable balance.
- Silently fall back from a failed live Stonk read to fake success.

## Solana tokens and burns

Sources:

- https://solana.com/docs/tokens (retrieved 2026-09-20)
- https://solana.com/docs/tokens/basics/burn-tokens (retrieved 2026-09-20)
- https://solana.com/docs/tokens/extensions/permissioned-burn (retrieved 2026-09-20)

Verified:

- Programs: classic `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`; Token-2022 `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`.
- Burn uses `Burn` or `BurnChecked`. `BurnChecked` includes mint decimals.
- Burn permanently decreases the token account balance and the mint supply.
- Authority is the token account owner, an approved delegate, or (Token-2022) a permanent delegate.
- Native mint is not burnable.
- `PermissionedBurnConfig` makes standard `Burn`/`BurnChecked` fail. STAMP rejects these mints.
- Freeze authority can prevent burns of frozen accounts.

Instruction indexes used by STAMP (classic SPL Token / Token-2022 shared numbering): `Burn=8`, `BurnChecked=15`.

Memo program used for same-transaction intent: `MemoSq4gqABAXKb96QnHj5ZbxdnGBnVWJChLWKFgS4`.

## Raydium LaunchLab

Sources:

- Stonk developer page (self-build section), 2026-09-20
- https://docs.raydium.io/products/launchlab/platforms (retrieved 2026-09-20)
- https://github.com/raydium-io/raydium-sdk-V2 (PDA helpers)

LaunchLab program id from Stonk pricing: `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`.

STAMP does not implement a live mainnet LaunchLab sender. The demo launch path mirrors the **documented fixed parameters** (6 decimals, 1e9 display supply, `totalSellA`) without claiming to have landed a Raydium pool.

## Zcash inscriptions and ZSA

Sources:

- https://zips.z.cash/zip-0226 (retrieved 2026-09-20) — **Status: Draft**
- https://zips.z.cash/zip-0227 (retrieved 2026-09-20) — **Status: Draft**
- https://zips.z.cash/zip-0225 (v5 transparent fields)
- https://zips.z.cash/zip-0317 (retrieved 2026-09-20)
- https://github.com/zcash/zcash/blob/v6.10.0/src/script/standard.h (`MAX_OP_RETURN_RELAY`)
- https://zebra.zfnd.org/internal/zebrad/components/mempool/config/constant.DEFAULT_MAX_DATACARRIER_BYTES.html (retrieved 2026-09-20)
- https://zebra.zfnd.org/dev/mempool-specification.html (retrieved 2026-09-20)
- https://zcash.github.io/zcash/user/end-of-life.html (retrieved 2026-09-20)
- https://zips.z.cash/zip-0300 (retrieved 2026-09-20) — **Status: Informational**, "has not achieved widespread adoption"
- https://zips.z.cash/zip-0112 (CHECKSEQUENCEVERIFY)
- https://zips.z.cash/zip-0320 (TEX addresses)

Verified:

- **`zcashd` reached end of life on 2026-07-18** (End-of-Support halt at block
  3,417,100, ahead of NU6.3 mainnet activation). Node operations use Zebra;
  wallet operations use Zallet. Any live publisher in this repository targets
  `zebrad` + Zallet, not `zcashd` RPC.
- **Zebra relay policy** matches the old zcashd default: `OP_RETURN` script
  ≤ `DEFAULT_MAX_DATACARRIER_BYTES` = 83 bytes (80 data bytes plus opcode and
  pushdata overhead), **at most one data output per transaction**, and
  non-`OP_RETURN` outputs must not be dust. STAMP issuance payloads are 38
  bytes and ownership records are 74, each in a single output.
- **Transparent HTLCs exist as a specification.** ZIP 300 defines P2SH scripts
  with hash locks and `OP_CHECKLOCKTIMEVERIFY` refunds for cross-chain atomic
  transactions, transparent only, and states it is not widely adopted. ZIP 112
  documents the related `CHECKSEQUENCEVERIFY` constructions. This supports the
  payment leg of a sale; it cannot make application-level ownership atomic.
- **TEX address encoding** (ZIP 320): P2PKH prefixes `0x1CB8` mainnet and
  `0x1D25` testnet, Bech32m HRPs `tex` and `textest`. The destination validator
  implements this.

- ZIP 226/227 define Orchard Zcash Shielded Assets. They are drafts. They are **not** a deployed issuance mechanism STAMP can call.
- Ordinary transparent inscriptions are not ZSAs, are not shielded, and do not provide private ownership.
- Transparent outputs are Bitcoin-encoded (`tx_out`).
- The 83-byte figure is **relay policy**, not a consensus maximum, in both the historical zcashd constant and Zebra's default.
- ZIP 317 conventional fee (revision 0): `5000 * max(2, logical_actions)` zatoshis. For a 1-input transparent publication with destination + OP_RETURN + change, logical actions are dominated by output size and are typically 5 → **25_000 zatoshis**, recomputed from the actual transaction when a live publisher exists.
- Shielded memo fields are 512 bytes and encrypted. STAMP v0 does **not** use them: the product requires a transparent inscription.

Maya Protocol's 80-byte memo note is a third-party integration guide, not a Zcash consensus rule. STAMP cites the node implementations' relay policy instead.

### Transparent address control (verified)

Proving control of a t-address is the scheme `zcashd` established and Zallet
kept, so any wallet that can `signmessage` produces a proof this build accepts.

- `strMessageMagic` is `"Zcash Signed Message:\n"` (zcash/zcash, `src/main.cpp`).
- The magic and the caller's message are each CompactSize-length-prefixed,
  concatenated, and double-SHA256 hashed.
- The signature is a recoverable ECDSA blob of 65 bytes, `[header][r][s]`,
  base64 encoded. `header = 27 + recovery_id`, plus 4 when the key is
  compressed.
- Verification recovers the public key, hashes it with hash160, and compares
  against the 20 bytes the address commits to. No key material is involved.

The magic prefix is the security boundary: it stops a signature over user text
from being replayed as a signature over a transaction, and it means a Bitcoin
signature will not verify here. That is intended.

Implemented in `src/lib/protocol/secp256k1.ts` (key recovery),
`src/lib/protocol/hash160.ts` (RIPEMD-160) and `src/lib/protocol/tsig.ts`
(digest, address binding), with no new dependencies. Node's crypto and the Web
Crypto API cannot recover a public key from a signature, so the curve
arithmetic is ours; it is checked against Node's ECDSA and against Bitcoin
Core's published `message_verify` vectors, whose scheme differs only in the
magic string. `verifyOwnerSignature` dispatches on address kind so the request
path and the deterministic rebuild apply one rule.

Address kinds differ in what they can prove:

| Kind | Proof |
| --- | --- |
| `t1…` p2pkh | Supported. Commits to one secp256k1 key. |
| `t3…` p2sh | Refused. Commits to a script, so a signed message cannot speak for it. |
| `tex1…` (ZIP 320) | Not implemented. |

Still unsolved: **signing Zcash v5 transactions.** Publishing an inscription
means building a NU5 transaction with a custom P2SH redeem script, and ZIP-244
replaced the sighash with a BLAKE2b digest tree using personalised hashes. That
is unrelated to message signing, which is why control proofs work while live
publication does not.

### Blockers for live Zcash publication

1. ZIP 226/227 are draft; ZSA issuance is unavailable.
2. A live publisher needs an isolated funded transparent key, a Zcash node or light client, and explicit approval to spend ZEC.
3. Mainnet burns and publication are disabled without `STAMP_ALLOW_LIVE_*`.
4. Listing a stamp held at a transparent address still needs a one-time proof
   of control, because the listing step asks for the owner's public key before
   any signature exists. Transfers from a transparent address are implemented
   and verified; see "Transparent address control" below.
5. No wallet was verified to construct or redeem the ZIP-300 P2SH branches, so
   real ZEC settlement stays behind `STAMP_ALLOW_LIVE_STAMP_SALES`.

STAMP therefore ships a versioned experimental protocol (`stamp-exp/0`) and a demo chain. It does not claim compatibility with any unnamed source project.

## Source-project inscription claims

No independently inspectable specification, repository, license, transfer rule, or transaction format for a prior "stamp" project was available in this repository or in the cited ZIPs. STAMP v0 is an explicitly separate experimental protocol.
