import { describe, expect, it } from "vitest";
import { postgresConfig } from "./database.js";
import { PGlite } from "@electric-sql/pglite";
import { randomBytes } from "node:crypto";
import { Cipher } from "./crypto.js";
import { Store } from "./store.js";
import { createApp } from "./app.js";

describe("PostgreSQL connection policy", () => {
  it("requires verified TLS outside loopback and bounds pooled work", () => {
    expect(postgresConfig("postgresql://example:example@database.example.test/applymate")).toMatchObject({
      max: 5, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000,
      statement_timeout: 30000, idle_in_transaction_session_timeout: 30000
    });
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(postgresConfig(`postgresql://example:example@${host}/applymate`, 2)).toMatchObject({ max: 2, ssl: false });
    }
  });
  it("rejects malformed URLs, unsafe URL overrides and unbounded pool configuration without exposing credentials", () => {
    for (const value of [
      "private-password", "https://example.test/applymate", "postgresql://example.test/",
      "postgresql://example:private-password@example.test/applymate?sslmode=disable",
      "postgresql://example:private-password@localhost/applymate?host=example.test",
      "postgresql://example.test/applymate?options=-c%20statement_timeout=0"
    ]) {
      expect(() => postgresConfig(value)).toThrow();
      try { postgresConfig(value); } catch (error) { expect(String(error)).not.toContain("private-password"); }
    }
    for (const max of [0, -1, 21, 1.5, NaN, Infinity]) {
      expect(() => postgresConfig("postgresql://localhost/applymate", max)).toThrow("integer from 1 through 20");
    }
  });
  it("does not permit local OTP to reuse cloud identities or opt into the external database", async () => {
    const cipher = new Cipher(randomBytes(32));
    await expect(createApp({
      cipher, origin: "http://localhost:4174", origins: ["http://localhost:4174"],
      databaseUrl: "postgresql://localhost/applymate"
    })).rejects.toMatchObject({ code: "DATABASE_CONFIG" });
    const database = new PGlite();
    try {
      const store = new Store(database, cipher);
      await store.migrate(true);
      await expect(store.migrate()).rejects.toMatchObject({ code: "DATABASE_IDENTITY" });
      await store.migrate(true);
    } finally { await database.close(); }
  });
});
