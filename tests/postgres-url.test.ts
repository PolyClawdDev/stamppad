import { describe, expect, it } from "vitest";
import { connectionString, hasPostgresUrl, postgresUrl } from "../src/lib/store/connection";

describe("postgres connection strings", () => {
  it("treats the Vercel Postgres name as enough", () => {
    const before = process.env.POSTGRES_URL;
    const hadDatabase = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      process.env.POSTGRES_URL = "postgres://stamp:stamp@127.0.0.1:5432/stamp";
      expect(hasPostgresUrl()).toBe(true);
      expect(postgresUrl()).toMatch(/^postgres:/);
    } finally {
      if (before === undefined) delete process.env.POSTGRES_URL;
      else process.env.POSTGRES_URL = before;
      if (hadDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = hadDatabase;
    }
  });

  it("adds sslmode on a Neon host that forgot it", () => {
    const url = "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb";
    expect(connectionString(url)).toBe(`${url}?sslmode=require`);
    expect(connectionString(`${url}?sslmode=require`)).toBe(`${url}?sslmode=require`);
  });
});
