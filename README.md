# Stamppad

**Small stamps. Big ideas.** Discover Solana coins and Zcash stamps.

Burn Solana tokens to create verifiable Zcash inscriptions. This is a burn-and-issue protocol, not a custodial reserve-backed wrapper.

Stamppad is an experimental application protocol (`stamp-exp` version 0). Zcash consensus does not enforce issuance or ownership. Independent validators do. This product is not affiliated with Stonk, Raydium, Solana, Zcash, or their developers.

Ordinary stamps are transparent inscriptions. They are not Shielded Assets, not private, and not redeemable. One-for-one quantity does not mean price parity. ZIP 226/227 ZSA migration is conditional on future network support and a separate specification — it is not automatic.

**No upstream "stamp protocol" specification or repository was supplied for this build, and none was found.** Compatibility with any such project is not claimed. `docs/EVIDENCE.md` lists exactly what is missing — inscription encoding, burn verification, recipient authorization, ownership transfer, double-sale prevention, settlement, wallet support, license — and what was verified from primary sources instead.

Ownership transfers and whole-stamp listings exist as `stamp-exp/1` and run on the simulated ledgers only. Spending an inscription's output does **not** transfer a stamp. Real burns, mainnet publication, and real ZEC sales are disabled by default flags.

## What works here

In **demo mode** (the default) you can:

1. Connect a browser-generated Solana keypair. The secret stays in `sessionStorage`. No seed phrase is requested.
2. Launch a coin whose supply and decimals come from the LaunchLab path Stonk publishes (1 billion tokens, 6 decimals).
3. See mint, transaction, a Stonk-shaped URL, and **actual** balances. Pool inventory is not credited to the creator.
4. Burn units you hold and receive a confirmed demo Zcash stamp.
5. Inspect launch aggregates and stamp verification evidence.
6. Export a claim package if publication fails after a finalized burn.
7. Transfer a stamp you own by signing a transfer authorization in the browser.
8. List a whole stamp for ZEC and walk the settlement steps against a simulated
   ZIP-300 HTLC. Add a second wallet with the `+` button to play both sides.

Live mainnet burns, LaunchLab sends, Zcash publication, and real sales are **off**. See `docs/STATUS.md` for verified / implemented / tested / blocked.

## Screens

| Screen | Path | What it shows |
| --- | --- | --- |
| Explore | `/` | Solana markets from this instance and every confirmed stamp with its current owner. |
| Launch | `/launch` | Launch form with the venue's fixed supply and decimals, separated costs, and real post-launch balances. |
| Token | `/launches/:mint` | Original supply, current supply, eligible burns, pending issuance, confirmed stamp units, and Solana market data labeled as not a stamp price. |
| Convert | `/convert` | Burn preview in base units, destination check, irreversibility notice, then the job. |
| Portfolio | `/portfolio` | Demo balances, stamps whose ownership resolves to your destination, and issuance jobs. |
| Marketplace | `/market` | A grid of postage-stamp cards with asking price and last sale kept apart, then the settlement steps, confirmed sales from the indexer, and the settlement disclosure. |
| Stamp | `/collections/:mint/stamps/:id` | Artwork, catalogue number, represented quantity, copyable inscription ID, the stamp's completed-sale chart, recent sales, and the trade panel. `/stamps/:id` redirects here. |

## Architecture

Each concern is a separate module with a demo and a live implementation; live
implementations refuse rather than degrade.

| Module | Path | Responsibility |
| --- | --- | --- |
| Launch integration | `src/lib/modules/launch.ts` | The only code that knows Stonk exists. |
| Burn verifier | `src/lib/modules/verifier.ts` | Fetches a transaction and hands it to the pure validator. Holds no keys. |
| Stamp publisher | `src/lib/modules/publisher.ts` | Writes payloads to Zcash. Decides nothing. |
| Wallet adapter | `src/lib/modules/wallet.ts` | Verifies signatures and reports which addresses can authorize. Never sees a private key. |
| Settlement adapter | `src/lib/modules/settlement.ts` | Listing lifecycle and the HTLC delivery sequence. |
| Deterministic indexer | `src/lib/indexer/` | Replays chain data into issuance and ownership. The source of truth for the UI. |
| Protocol | `src/lib/protocol/` | Pure encoding, validation, ownership resolution. No I/O. |

## Local setup

```bash
npm install
cp .env.example .env.local
npm test
npm run dev
```

Open http://127.0.0.1:3477. The default store is an on-disk JSON file (`.stamp-memory.json`) so jobs survive a process restart. The UI banner says `DEMO LEDGER`.

`dev` and `start` bind to `127.0.0.1:3477`. The explicit host matters: without it
Next enumerates network interfaces to print a LAN URL, which fails under a
restricted sandbox and takes the server down on boot.

For a production-style run:

```bash
npm run build
npm start
```

Optional durable PostgreSQL:

```bash
docker compose up -d
# in .env.local
# STAMP_STORE=postgres
# DATABASE_URL=postgres://stamp:stamp@127.0.0.1:5432/stamp
npm run db:migrate
npm run dev
```

In another terminal:

```bash
npm run worker
```

Demo mode also advances jobs when you hit `/api/status` or `/api/jobs/:id`, so a separate worker is optional locally.

Rebuild the protocol ledger from persisted chain data (two independent runs must match). This covers issuance, ownership transfers, and confirmed sales, and reads nothing from listing state:

```bash
npm run ledger:rebuild
```

Fill the demo ledger with several stamps and completed sales, so the charts
have something real to plot (demo mode only, drives the public HTTP API):

```bash
npm run seed:market -- http://127.0.0.1:3477
```

The same replay is served at `/api/indexer` so anyone can diff it against their own.

## Environment

See `.env.example`. Never put secrets in the template.

- `STAMP_MODE=demo|testnet|mainnet`
- `STAMP_ALLOW_LIVE_LAUNCH`, `STAMP_ALLOW_LIVE_BURNS`, `STAMP_ALLOW_LIVE_ZCASH_PUBLISH`, `STAMP_ALLOW_LIVE_STAMP_SALES` default false
- `STAMP_STONK_READ_LIVE=true` uses live Stonk reads and **fails closed** if they fail
- `ZCASH_PUBLISHER_KEY_FILE` is for an isolated publisher process only. Paying ZIP-317 fees is not custody of burned tokens.

## Documentation

- `docs/EVIDENCE.md` — the research gate: missing upstream evidence vs what was verified
- `docs/INTEGRATION.md` — verified Stonk / Solana / Zcash findings with source links and dates
- `docs/PROTOCOL.md` — stamp-exp/0 issuance and stamp-exp/1 ownership and settlement
- `docs/THREAT_MODEL.md`
- `docs/STATUS.md` — working issuance vs simulated ownership vs conditional ZSA

## Blockers for real issuance

1. Stonk `POST /launches/prepare` returned HTTP 503 on 2026-09-20 (`paidLaunchesEnabled=false`). The documented live path is self-built Raydium LaunchLab on **mainnet**.
2. Live LaunchLab construction spends real SOL. Disabled without explicit approval.
3. Live Zcash publication needs an isolated funded transparent key and a node. `zcashd` reached end of life on 2026-07-18, so any live path targets `zebrad` plus Zallet. ZIP 226/227 are still drafts, so ZSAs are unavailable.
4. Mainnet burns are irreversible and disabled by default.
5. Ownership needs a signature attributable to the destination address. Binding to the secp256k1 key behind a t-address is not implemented, so only protocol-managed demo destinations can be transferred or listed.
6. ZEC settlement is not consensus-atomic and no wallet was verified to redeem ZIP-300 P2SH branches, so real sales are disabled.

The demo does not invent a working live integration.
