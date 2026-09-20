import { storeKind } from "../mode";
import { MemoryStore } from "./memory";
import { PostgresStore } from "./postgres";
import type { Store } from "./types";

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;
  cached = storeKind() === "postgres" ? new PostgresStore() : new MemoryStore();
  return cached;
}

export function setStoreForTests(store: Store): void {
  cached = store;
}

export type {
  Store,
  LaunchRow,
  JobRow,
  StampRow,
  ListingRow,
  ListingState,
  TransferRow,
} from "./types";
