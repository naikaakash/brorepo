import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { activitySchema, objectSchemas } from "@applymate/contracts";
import type { EntityMap, ObjectKind, z } from "@applymate/contracts";
import type { Cipher } from "./crypto.js";
import { AppError, requireCondition } from "./errors.js";

type Queryable = Pick<PGlite, "query" | "exec">;
interface Row { id: string; owner: string; kind: ObjectKind; payload: string; revision: number; locked: boolean }
export interface Stored<T> { value: T; revision: number; locked: boolean }

export function metadata() {
  const now = new Date().toISOString();
  return { id: randomUUID(), createdAt: now, updatedAt: now };
}

const migration = `
CREATE TABLE IF NOT EXISTS storage_metadata (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL, "termsVersion" text NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY, token text NOT NULL UNIQUE, "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL,
  "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_owner ON session("userId");
CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamp,
  "refreshTokenExpiresAt" timestamp, scope text, password text,
  "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL
);
CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier ON verification(identifier);
CREATE TABLE IF NOT EXISTS "rateLimit" (
  id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS objects (
  id uuid PRIMARY KEY, owner text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind text NOT NULL, payload text NOT NULL, revision integer NOT NULL DEFAULT 0,
  locked boolean NOT NULL DEFAULT false, state text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS objects_owner_kind ON objects(owner, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS objects_work_queue ON objects(kind, state);
CREATE UNIQUE INDEX IF NOT EXISTS one_profile ON objects(owner) WHERE kind = 'profile';
CREATE UNIQUE INDEX IF NOT EXISTS one_preferences ON objects(owner) WHERE kind = 'preferences';
CREATE TABLE IF NOT EXISTS private_data (
  id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  owner text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind text NOT NULL, payload text NOT NULL, PRIMARY KEY (id, kind)
);
CREATE TABLE IF NOT EXISTS operation_limits (
  owner text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, bucket text NOT NULL,
  count integer NOT NULL, PRIMARY KEY(owner, bucket)
);
`;

export class Store {
  constructor(public readonly database: PGlite, private readonly cipher: Cipher, private readonly connection: Queryable = database) {}

  async migrate() {
    await this.connection.exec(migration);
    const marker = await this.connection.query<{ value: string }>("SELECT value FROM storage_metadata WHERE key = 'cipher'");
    try {
      if (marker.rows[0]) {
        requireCondition(this.cipher.open(marker.rows[0].value, "database:key-check") === "applymate-store-v1",
          500, "KEY_MISMATCH", "Restore the original encryption key for this database.");
        return;
      }
      const existing = await this.connection.query<Row>("SELECT id, owner, kind, payload FROM objects LIMIT 1");
      if (existing.rows[0]) {
        const row = existing.rows[0];
        this.cipher.open(row.payload, `${row.owner}:${row.kind}:${row.id}`);
      }
    } catch {
      throw new AppError(500, "KEY_MISMATCH", "The encryption key does not match this database. Restore its original key; no data was replaced.");
    }
    await this.connection.query("INSERT INTO storage_metadata(key, value) VALUES ('cipher', $1)",
      [this.cipher.seal("applymate-store-v1", "database:key-check")]);
  }
  async transaction<T>(fn: (store: Store) => Promise<T>): Promise<T> {
    return this.database.transaction((tx) => fn(new Store(this.database, this.cipher, tx)));
  }

  private decode<T>(row: Row, schema: z.ZodType<T>): Stored<T> {
    const value: unknown = JSON.parse(this.cipher.open(row.payload, `${row.owner}:${row.kind}:${row.id}`));
    return { value: schema.parse(value), revision: row.revision, locked: row.locked };
  }

  async get<T>(owner: string, kind: ObjectKind, id: string, schema: z.ZodType<T>): Promise<Stored<T>> {
    const result = await this.connection.query<Row>(
      "SELECT id, owner, kind, payload, revision, locked FROM objects WHERE owner = $1 AND kind = $2 AND id = $3",
      [owner, kind, id]
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "That item is unavailable or does not belong to your account.");
    return this.decode(result.rows[0], schema);
  }

  async list<T>(owner: string, kind: ObjectKind, schema: z.ZodType<T>, limit = 200): Promise<Stored<T>[]> {
    const result = await this.connection.query<Row>(
      "SELECT id, owner, kind, payload, revision, locked FROM objects WHERE owner = $1 AND kind = $2 ORDER BY created_at DESC, id LIMIT $3",
      [owner, kind, Math.min(limit, 250)]
    );
    return result.rows.map((row) => this.decode(row, schema));
  }

  async create<K extends ObjectKind>(owner: string, kind: K, value: EntityMap[K], locked = false): Promise<void> {
    const parsed = objectSchemas[kind].parse(value);
    const payload = this.cipher.seal(JSON.stringify(parsed), `${owner}:${kind}:${parsed.id}`);
    await this.connection.query(
      "INSERT INTO objects(id, owner, kind, payload, locked, state) VALUES ($1, $2, $3, $4, $5, $6)",
      [parsed.id, owner, kind, payload, locked, "state" in parsed ? parsed.state : ""]
    );
  }

  async update<K extends ObjectKind>(owner: string, kind: K, value: EntityMap[K], expectedRevision: number, locked = false): Promise<void> {
    const parsed = objectSchemas[kind].parse(value);
    const payload = this.cipher.seal(JSON.stringify(parsed), `${owner}:${kind}:${parsed.id}`);
    const result = await this.connection.query<{ id: string }>(
      `UPDATE objects SET payload = $4, revision = revision + 1, locked = $6, state = $7
       WHERE id = $1 AND owner = $2 AND kind = $3 AND revision = $5 AND NOT locked RETURNING id`,
      [parsed.id, owner, kind, payload, expectedRevision, locked, "state" in parsed ? parsed.state : ""]
    );
    requireCondition(result.rows.length, 409, "CHANGED_OR_IMMUTABLE", "This item changed or is already immutable. Refresh before continuing.");
  }

  async remove(owner: string, kind: ObjectKind, id: string): Promise<void> {
    const result = await this.connection.query<{ id: string }>(
      "DELETE FROM objects WHERE owner = $1 AND kind = $2 AND id = $3 AND NOT locked RETURNING id", [owner, kind, id]
    );
    requireCondition(result.rows.length, 404, "NOT_FOUND", "That item is unavailable or immutable.");
  }

  async putPrivate(owner: string, id: string, kind: "binary" | "key", value: string): Promise<void> {
    const payload = this.cipher.seal(value, `${owner}:private:${kind}:${id}`);
    const result = await this.connection.query<{ id: string }>(
      `INSERT INTO private_data(id, owner, kind, payload)
       SELECT id, owner, $3, $4 FROM objects WHERE id = $1 AND owner = $2
       AND (($3 = 'binary' AND kind = 'document') OR ($3 = 'key' AND kind = 'connection'))
       ON CONFLICT (id, kind) DO NOTHING RETURNING id`,
      [id, owner, kind, payload]
    );
    requireCondition(result.rows.length, 409, "PRIVATE_RESOURCE", "Private data must belong to an existing owned item and cannot be overwritten.");
  }

  async getPrivate(owner: string, id: string, kind: "binary" | "key"): Promise<string> {
    const result = await this.connection.query<{ payload: string }>(
      "SELECT payload FROM private_data WHERE owner = $1 AND id = $2 AND kind = $3", [owner, id, kind]
    );
    requireCondition(result.rows[0], 404, "NOT_FOUND", "The requested private resource was not found.");
    return this.cipher.open(result.rows[0].payload, `${owner}:private:${kind}:${id}`);
  }

  async count(owner: string, kind: ObjectKind): Promise<number> {
    const result = await this.connection.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM objects WHERE owner = $1 AND kind = $2", [owner, kind]
    );
    return result.rows[0].count;
  }

  async consumeLimit(owner: string, bucket: string, maximum: number): Promise<void> {
    const result = await this.connection.query<{ count: number }>(
      `INSERT INTO operation_limits(owner, bucket, count) VALUES ($1, $2, 1)
       ON CONFLICT(owner, bucket) DO UPDATE SET count = operation_limits.count + 1
       WHERE operation_limits.count < $3 RETURNING count`, [owner, bucket, maximum]
    );
    requireCondition(result.rows.length, 429, "LIMIT_REACHED", "Your local safety limit has been reached. Try again in the next time window.");
  }

  async event(owner: string, action: string, objectId: string, detail: string) {
    await this.create(owner, "activity", activitySchema.parse({ ...metadata(), action, objectId, detail }));
    await this.connection.query(
      `DELETE FROM objects WHERE owner = $1 AND kind = 'activity' AND id NOT IN
       (SELECT id FROM objects WHERE owner = $1 AND kind = 'activity' ORDER BY created_at DESC LIMIT 100)`, [owner]
    );
  }

  async queued(): Promise<{ owner: string; id: string; state: string }[]> {
    const result = await this.connection.query<{ owner: string; id: string; state: string }>(
      "SELECT owner, id, state FROM objects WHERE kind = 'package' AND state IN ('queued', 'generating', 'reviewing') ORDER BY created_at LIMIT 200"
    );
    return result.rows;
  }

  async deleteUser(owner: string): Promise<void> {
    await this.connection.query('DELETE FROM "user" WHERE id = $1', [owner]);
  }
}
