# Integration status

Legend: **verified** (docs/live probe) · **implemented** (code exists) · **tested** (automated) · **blocked** (cannot honestly claim working issuance).

| Surface | Status | Notes |
| --- | --- | --- |
| Stonk `GET /stats` | verified, implemented | Live probe 2026-09-20. Demo uses captured fixtures unless `STAMP_STONK_READ_LIVE=true`. |
| Stonk `GET /pairs` | verified, implemented | Schema captured from live JSON. |
| Stonk `GET /launchlab/pricing` | verified, implemented | Schema captured from live JSON. Supply/decimals come from this path, not user input. |
| Stonk `POST /launches/prepare` | verified **disabled** | HTTP 503 on 2026-09-20. A separate Stonk feature; it does not gate the LaunchLab route and is not used. |
| Stonk LaunchLab self-build | verified, implemented, tested, **simulated on mainnet** | `initialize_with_token_2022` plus the creator's `buy_exact_in`, built from live pricing with Stonk's platform id and curve rule. Proved with `simulateTransaction` against mainnet on 2026-09-21: succeeded, around 171,000 compute units, 0.01164304 SOL of rent and signature fees. Sending is flag-gated off and requires the creator's own wallet. |
| Mainnet burn with destination memo | implemented, tested, **simulated on mainnet** | `burnChecked` plus SPL Memo v3 in one transaction. Simulated 2026-09-21 with a log byte-identical to the reference burn `RcxGYhJt…x8M`. Flag-gated off. |
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
| Ownership transfers (`stamp-exp/1`) | implemented (demo), tested, **blocked** (live) | Signed transfer record plus published authorization. Spending the inscription output does **not** transfer a stamp. Transparent addresses are transferable: the holder signs with their own wallet's `signmessage` and the key is recovered from the compact signature. Listing one still needs a one-time control proof. |
| Whole-stamp listings | implemented (demo), tested | One live listing per stamp; one buyer per ownership sequence. No partial fills, no split/merge. |
| ZEC settlement | **blocked** | ZIP-300 HTLC design is specified and simulated. Real sales require `STAMP_ALLOW_LIVE_STAMP_SALES` and are off. Not consensus-atomic; see `docs/PROTOCOL.md` §22. |
| Zebra relay constraints | verified, implemented | One `OP_RETURN` per transaction, ≤80 data bytes. Issuance 38 bytes, ownership records 74 bytes. |
| `zcashd` end of life | verified | Halted 2026-07-18 at block 3,417,100. Any live path targets `zebrad` + Zallet. |
| ZSA migration | conditional future | Separate spec required after network support. |

## What works in this repository

In `STAMP_MODE=demo` you can:

1. Connect Phantom through its injected provider and prove the key with a signed,
   nonce-bound statement the server verifies. No key is generated or requested.
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

1. **A mainnet launch is not free and not reversible.** The transaction is built
   and proved by simulation, but sending it costs about 0.0114 SOL in rent and
   fees plus the quote asset the creator spends on their own allocation, and
   creates a real mint. It is off unless `STAMP_ALLOW_LIVE_LAUNCH=true`, and even
   then this server cannot send it: the creator's wallet signs.
2. **A ZEC-paired launch is bought with ZEC, not SOL.** The creator needs a
   balance of the quote SPL token before the initial buy can fill, and without
   an initial buy there is no allocation to burn into a stamp.
3. **No funded isolated Zcash publisher.** Live inscription needs ZEC for ZIP-317 fees. That key must not live on the app server.
4. **ZSAs are draft.** Transparent OP_RETURN stamps are not Shielded Assets.
5. **Mainnet burns are irreversible.** Default flags refuse them.
6. **Listing a transparent-address stamp needs a control proof.** Transferring
   one is implemented and tested: the holder signs the canonical preimage with
   `signmessage` and the secp256k1 key is recovered from it. Listing asks for
   the owner's public key before any signature exists, so that screen still
   refuses. Signing Zcash v5 transactions (ZIP-244) remains unsolved and is a
   separate problem from message signing.
7. **HTLC settlement is untested against real wallets.** ZIP 300 is
   Informational and, by its own status section, not widely adopted. No wallet
   was verified to redeem the P2SH branches, so real sales are off.

Do not treat the demo as a live integration.
