import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/pglite";
import nodemailer from "nodemailer";
import { policyVersion } from "@applymate/contracts";
import type { Store } from "./store.js";
import type { Cipher } from "./crypto.js";
import * as schema from "./auth-schema.js";

export interface LocalLetter { email: string; code: string; type: string; expiresAt: string }
export interface AuthConfig { origin: string; origins: string[]; smtpUrl?: string; smtpFrom?: string; rateLimit?: number }

export function createIdentity(store: Store, cipher: Cipher, config: AuthConfig) {
  const outbox = new Map<string, LocalLetter>();
  const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl, { from: config.smtpFrom }) : null;
  const auth = betterAuth({
    appName: "ApplyMate",
    baseURL: config.origin,
    trustedOrigins: config.origins,
    secret: cipher.authSecret(),
    database: drizzleAdapter(drizzle(store.database), { provider: "pg", schema }),
    telemetry: { enabled: false },
    logger: {
      level: "error",
      log: () => { console.error("[ApplyMate] Authentication operation failed. No request data recorded."); }
    },
    advanced: {
      useSecureCookies: config.origin.startsWith("https:"),
      cookiePrefix: "applymate",
      database: { generateId: () => randomUUID() },
      ipAddress: { ipAddressHeaders: [] }
    },
    user: { additionalFields: { termsVersion: { type: "string", required: true, input: false, defaultValue: policyVersion } } },
    session: { expiresIn: 60 * 60 * 24 * 7, freshAge: 300, cookieCache: { enabled: false } },
    verification: { storeIdentifier: "hashed" },
    rateLimit: {
      enabled: true, storage: "database", window: 60, max: 120,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: config.rateLimit ?? 5 },
        "/sign-in/email-otp": { window: 60, max: config.rateLimit ?? 15 }
      }
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email-otp" && ctx.headers?.get("x-applymate-consent") !== policyVersion) {
          throw new APIError("BAD_REQUEST", { message: "Please acknowledge the local data and privacy notice before signing in." });
        }
      })
    },
    plugins: [
      emailOTP({
        otpLength: 6, expiresIn: 600, allowedAttempts: 5, storeOTP: "hashed",
        overrideDefaultEmailVerification: true,
        changeEmail: { enabled: true, verifyCurrentEmail: true },
        async sendVerificationOTP({ email, otp, type }) {
          if (transport) {
            await transport.sendMail({
              to: email, subject: "Your ApplyMate verification code",
              text: `Your ApplyMate code is ${otp}. It expires in 10 minutes. If you did not request it, ignore this email.`
            });
          } else {
            const now = Date.now();
            for (const [key, letter] of outbox) {
              if (Date.parse(letter.expiresAt) < now) outbox.delete(key);
            }
            if (outbox.size >= 100) throw new APIError("TOO_MANY_REQUESTS", { message: "The local mailbox is full. Try again after existing codes expire." });
            outbox.set(email.toLowerCase(), { email, code: otp, type, expiresAt: new Date(now + 600000).toISOString() });
          }
        }
      })
    ]
  });
  return { auth, outbox, mailMode: transport ? "smtp" as const : "local" as const, close: () => transport?.close() };
}
