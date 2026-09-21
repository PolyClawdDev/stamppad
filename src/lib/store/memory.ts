import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { emptyChain } from "../solana/demo";
import { emptyZcash } from "../zcash/demo";
import { deserializeClaim, deserializeDemo, serializeClaim, serializeDemo } from "./serialize";
import type { JobRow, LaunchRow, ListingRow, StampRow, Store, TransferRow } from "./types";

/**
 * A job on disk differs from a job in memory in exactly one place: the claim
 * package holds a canonical Solana transaction, whose bigint balances and raw
 * instruction bytes have no JSON of their own.
 */
type StoredJob = Omit<JobRow, "claimPackage"> & {
  claimPackage: ReturnType<typeof serializeClaim> | null;
};

function toStored(row: JobRow): StoredJob {
  return { ...row, claimPackage: row.claimPackage ? serializeClaim(row.claimPackage) : null };
}

function fromStored(row: StoredJob): JobRow {
  return { ...row, claimPackage: row.claimPackage ? deserializeClaim(row.claimPackage) : null };
}

function withLaunchLinks(row: LaunchRow): LaunchRow {
  return {
    ...row,
    website: row.website ?? "",
    twitter: row.twitter ?? "",
    telegram: row.telegram ?? "",
  };
}

interface MemoryShape {
  launches: Record<string, LaunchRow>;
  jobs: Record<string, StoredJob>;
  stamps: Record<string, StampRow>;
  listings: Record<string, ListingRow>;
  transfers: Record<string, TransferRow>;
  demo: ReturnType<typeof serializeDemo>;
}

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serverless hosts mount the deployment read-only, so the ledger cannot sit
 * next to the code. State written to the temp directory belongs to one
 * instance and is gone after a cold start; STAMP_STORE=postgres is the only
 * durable option.
 */
const HOSTED = !process.env.STAMP_MEMORY_FILE && !writable(process.cwd());
const DEFAULT_PATH =
  process.env.STAMP_MEMORY_FILE ?? (HOSTED ? join(tmpdir(), "stamp-memory.json") : ".stamp-memory.json");

export function memoryStateInfo(): { path: string; ephemeral: boolean } {
  return { path: DEFAULT_PATH, ephemeral: HOSTED };
}

/** Every instance opens on an empty ledger and fills up from real activity. */
export function initialState(): MemoryShape {
  return {
    launches: {},
    jobs: {},
    stamps: {},
    listings: {},
    transfers: {},
    demo: serializeDemo(emptyChain(), emptyZcash()),
  };
}

export class MemoryStore implements Store {
  constructor(private readonly path = DEFAULT_PATH) {}

  private read(): MemoryShape {
    let data: MemoryShape;
    try {
      data = JSON.parse(readFileSync(this.path, "utf8")) as MemoryShape;
    } catch {
      data = initialState();
    }
    data.listings ??= {};
    data.transfers ??= {};
    return data;
  }

  private write(data: MemoryShape): void {
    mkdirSync(dirname(this.path) === "." ? process.cwd() : dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      `${JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString(10) : value), 2)}\n`,
    );
  }

  async listLaunches() {
    return Object.values(this.read().launches)
      .map(withLaunchLinks)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async getLaunch(mint: string) {
    const row = this.read().launches[mint];
    return row ? withLaunchLinks(row) : null;
  }
  async upsertLaunch(row: LaunchRow) {
    const data = this.read();
    data.launches[row.mint] = row;
    this.write(data);
  }
  async listJobs() {
    return Object.values(this.read().jobs)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(fromStored);
  }
  async getJob(id: string) {
    const row = this.read().jobs[id];
    return row ? fromStored(row) : null;
  }
  async findJobByIdempotency(key: string) {
    const row = Object.values(this.read().jobs).find((j) => j.idempotencyKey === key);
    return row ? fromStored(row) : null;
  }
  async upsertJob(row: JobRow) {
    const data = this.read();
    data.jobs[row.id] = toStored(row);
    this.write(data);
  }
  async listStamps() {
    return Object.values(this.read().stamps).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async getStamp(id: string) {
    return this.read().stamps[id] ?? null;
  }
  async stampsForMint(mint: string) {
    return (await this.listStamps()).filter((s) => s.mint === mint);
  }
  async upsertStamp(row: StampRow) {
    const data = this.read();
    data.stamps[row.id] = row;
    this.write(data);
  }
  async listListings() {
    return Object.values(this.read().listings).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async getListing(id: string) {
    return this.read().listings[id] ?? null;
  }
  async upsertListing(row: ListingRow) {
    const data = this.read();
    data.listings[row.id] = row;
    this.write(data);
  }
  async listTransfers() {
    return Object.values(this.read().transfers).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async upsertTransfer(row: TransferRow) {
    const data = this.read();
    data.transfers[row.id] = row;
    this.write(data);
  }
  async loadDemo() {
    return deserializeDemo(this.read().demo);
  }
  async saveDemo(solana: import("../solana/demo").DemoChainState, zcash: import("../zcash/demo").DemoZcashChain) {
    const data = this.read();
    data.demo = serializeDemo(solana, zcash);
    this.write(data);
  }
}
