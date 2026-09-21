import { storeKind } from "../mode";
import { memoryStateInfo } from "./memory";

export type Durability = "durable" | "file" | "ephemeral";

/**
 * How long anything written here survives.
 *
 * "durable" is Postgres. "file" is a local development ledger, which lives as
 * long as the working copy does. "ephemeral" is a hosted deployment with no
 * database: the ledger is in the instance's temp directory, every invocation
 * may land on a different instance, and a launch written by one request is
 * simply not there for the next one.
 */
export function durability(): Durability {
  if (storeKind() === "postgres") return "durable";
  return memoryStateInfo().ephemeral ? "ephemeral" : "file";
}

export const EPHEMERAL_STORE_MESSAGE =
  "This deployment has no database, so anything written here is lost as soon as the request ends. " +
  "In Vercel, open Storage, open the Neon database, connect it to this project for Production, " +
  "and redeploy. DATABASE_URL or POSTGRES_URL is enough; the schema is created on the first request.";

/**
 * Why a write must be refused, or null when it may proceed.
 *
 * A hosted instance without a database cannot keep a launch, and the user will
 * meet that fact later as a coin page that says the launch does not exist.
 * Refusing up front, naming the missing configuration, is the only honest
 * answer available.
 */
export function durabilityProblem(): string | null {
  return durability() === "ephemeral" ? EPHEMERAL_STORE_MESSAGE : null;
}
