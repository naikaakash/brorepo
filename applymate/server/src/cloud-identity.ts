import type { Request } from "express";
import { z } from "@applymate/contracts";
import { digest } from "./crypto.js";
import { requireCondition } from "./errors.js";

export interface CloudConfig { tenant: string; objectId: string; publicSignup?: boolean }
export interface CloudIdentity { id: string; email: string; name: string; sessionCreatedAt: Date }
const principalSchema = z.object({
  auth_typ: z.literal("aad"),
  claims: z.array(z.object({ typ: z.string(), val: z.string() })).max(200)
});
const microsoftIdSchema = z.guid().refine((value) => value !== "00000000-0000-0000-0000-000000000000");

// Only enable behind App Service Easy Auth, which strips external principal headers.
export function cloudIdentity(req: Request, config: CloudConfig): CloudIdentity {
  const encoded = req.get("x-ms-client-principal");
  requireCondition(encoded && encoded.length <= 32768, 401, "SIGN_IN_REQUIRED", "Sign in with Microsoft to continue.");
  let raw: unknown;
  try { raw = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); }
  catch { raw = null; }
  const parsed = principalSchema.safeParse(raw);
  requireCondition(parsed.success, 401, "SIGN_IN_REQUIRED", "The hosting platform did not supply a valid Microsoft identity.");
  const claim = (...names: string[]) => parsed.data.claims.find((entry) => names.includes(entry.typ))?.val;
  const tenant = claim("tid", "http://schemas.microsoft.com/identity/claims/tenantid");
  const objectId = claim("oid", "http://schemas.microsoft.com/identity/claims/objectidentifier");
  requireCondition(config.publicSignup ? microsoftIdSchema.safeParse(tenant).success && microsoftIdSchema.safeParse(objectId).success :
    tenant === config.tenant && objectId === config.objectId,
    403, "PILOT_ACCESS", config.publicSignup ? "Microsoft must provide a valid tenant and user identity." : "This personal pilot is restricted to its owner.");
  const email = claim("email", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "preferred_username", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name");
  requireCondition(z.email().safeParse(email).success, 403, "IDENTITY_EMAIL", "Your Microsoft identity must provide a valid email address.");
  const authenticatedAt = claim("auth_time") ?? claim("http://schemas.microsoft.com/ws/2008/06/identity/claims/authenticationinstant");
  const issued = authenticatedAt === undefined ? Number(claim("iat")) :
    /^\d+$/.test(authenticatedAt) ? Number(authenticatedAt) : Date.parse(authenticatedAt) / 1000;
  const age = Date.now() / 1000 - issued;
  requireCondition(Number.isFinite(issued) && issued > 0 && age >= -60 && age <= 86400,
    401, "REAUTHENTICATE", "Sign out and sign in with Microsoft again to renew this pilot session.");
  return {
    id: digest(`${tenant}:${objectId}`), email: email!,
    name: claim("name") || email!, sessionCreatedAt: new Date(issued * 1000)
  };
}
