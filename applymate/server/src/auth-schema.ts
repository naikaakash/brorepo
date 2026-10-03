import { bigint, boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text().primaryKey(), name: text().notNull(), email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false), image: text(),
  createdAt: timestamp().notNull(), updatedAt: timestamp().notNull(),
  termsVersion: text().notNull()
});
export const session = pgTable("session", {
  id: text().primaryKey(), token: text().notNull().unique(), expiresAt: timestamp().notNull(),
  createdAt: timestamp().notNull(), updatedAt: timestamp().notNull(),
  ipAddress: text(), userAgent: text(),
  userId: text().notNull().references(() => user.id, { onDelete: "cascade" })
});
export const account = pgTable("account", {
  id: text().primaryKey(), accountId: text().notNull(), providerId: text().notNull(),
  userId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text(), refreshToken: text(), idToken: text(),
  accessTokenExpiresAt: timestamp(), refreshTokenExpiresAt: timestamp(),
  scope: text(), password: text(), createdAt: timestamp().notNull(), updatedAt: timestamp().notNull()
});
export const verification = pgTable("verification", {
  id: text().primaryKey(), identifier: text().notNull(), value: text().notNull(),
  expiresAt: timestamp().notNull(), createdAt: timestamp().notNull(), updatedAt: timestamp().notNull()
});
export const rateLimit = pgTable("rateLimit", {
  id: text().primaryKey(), key: text().notNull().unique(), count: integer().notNull(),
  lastRequest: bigint({ mode: "number" }).notNull()
});
