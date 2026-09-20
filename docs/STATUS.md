# Integration status

Legend: **verified** (docs/live probe) · **implemented** (code exists) · **tested** (automated) · **blocked** (cannot honestly claim working issuance).

| Surface | Status | Notes |
| --- | --- | --- |
| Stonk `GET /stats` | verified, implemented | Live probe 2026-09-20. Demo uses captured fixtures unless `STAMP_STONK_READ_LIVE=true`. |
| Stonk `GET /pairs` | verified, implemented | Schema captured from live JSON. |
| Stonk `GET /launchlab/pricing` | verified, implemented | Schema captured from live JSON. Supply/decimals come from this path, not user input. |
| Stonk `POST /launches/prepare` | verified **disabled** | HTTP 503 on 2026-09-20. Not implemented as a working launcher. |
| Stonk LaunchLab self-build | verified, **blocked** for money movement | Documented. STAMP will not send mainnet LaunchLab transactions without explicit approval. Demo launch mirrors published constants only. |
| Stonk `GET /tokens` / `{mint}` | documented, partial | List returned HTTP 500 from this environment on 2026-09-20. Adapter treats live failures as failures. |
| Solana burn verify | verified, implemented, tested | Pure validator over a canonical transaction. Live RPC adapter is read-capable; live burns are flag-gated and default off. |
| Token-2022 unsupported extensions | implemented, tested | Rejected with an explicit reason. |
| STAMP v0 specification | implemented | `docs/PROTOCOL.md`. Experimental. Not a ZSA. Not compatible with an unverified source project. |
| Same-tx intent memo binding | implemented, tested | Destination chooser is the burn authority that signed the Solana transaction. |
| Zcash OP_RETURN publication | implemented (demo), **blocked** (live) | Encoding stays within zebrad's 80-byte data relay policy. Live publisher needs an isolated key + node + approval. |
| ZIP 226/227 ZSA issuance | verified draft, **blocked** | Not deployed. No automatic conversion is promised. |
| Worker state machine | implemented, tested | Survives restart after a finalized burn (in-memory and postgres stores persist jobs). |
| Ledger rebuild | implemented, tested | `npm run ledger:rebuild`. Two rebuilds of issuance **and** ownership are byte-identical. |
| Upstream stamp protocol compatibility | **not claimed** | No repository or specification was supplied. See `docs/EVIDENCE.md`. |
| Ownership transfers (`stamp-exp/1`) | implemented (demo), tested, **blocked** (live) | Signed transfer record plus published authorization. Spending the inscription output does **not** transfer a stamp. Mainnet t-address key binding is not implemented, so those stamps are non-transferable here. |
| Whole-stamp listings | implemented (demo), tested | One live listing per stamp; one buyer per ownership sequence. No partial fills, no split/merge. |
| ZEC settlement | **blocked** | ZIP-300 HTLC design is specified and simulated. Real sales require `STAMP_ALLOW_LIVE_STAMP_SALES` and are off. Not consensus-atomic; see `docs/PROTOCOL.md` §22. |
| Zebra relay constraints | verified, implemented | One `OP_RETURN` per transaction, ≤80 data bytes. Issuance 38 bytes, ownership records 74 bytes. |
| `zcashd` end of life | verified | Halted 2026-07-18 at block 3,417,100. Any live path targets `zebrad` + Zallet. |
| ZSA migration | conditional future | Separate spec required after network support. |

## What works in this repository

In `STAMP_MODE=demo` you can:

1. Connect a browser-generated demo Solana wallet (secret never leaves the browser).
2. Launch a coin whose supply and decimals match the captured LaunchLab path.
3. See mint, demo transaction, a Stonk-shaped page URL, and **actual** balances (pool inventory is not credited to the creator).
4. Burn owned units and receive a confirmed demo Zcash stamp.
5. Inspect launch aggregates and stamp verification.
6. Export a claim package if publication is forced into a recoverable failure.
7. Transfer a stamp you own by signing a transfer authorization, and watch the
   indexer apply it only after the record confirms.
8. List a whole stamp for ZEC and walk the six-step settlement on the simulated
   HTLC: reserve, publish offer, authorize, lock, publish transfer, claim.

## Precise live blockers

1. **Stonk paid launch API is off.** `paidLaunchesEnabled=false`; `POST /launches/prepare` returns 503.
2. **LaunchLab is mainnet.** Sending a LaunchLab initialize spends real SOL and creates a real mint. Disabled.
3. **No funded isolated Zcash publisher.** Live inscription needs ZEC for ZIP-317 fees. That key must not live on the app server.
4. **ZSAs are draft.** Transparent OP_RETURN stamps are not Shielded Assets.
5. **Mainnet burns are irreversible.** Default flags refuse them.
6. **No verified key binding for external t-addresses.** Ownership operations
   need a signature attributable to the destination. Only demo destinations
   have that binding here, so mainnet ownership transfer is disabled.
7. **HTLC settlement is untested against real wallets.** ZIP 300 is
   Informational and, by its own status section, not widely adopted. No wallet
   was verified to redeem the P2SH branches, so real sales are off.

Do not treat the demo as a live integration.
