import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "./errors.js";

export function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export class Cipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("ApplyMate requires a 32-byte encryption key.");
  }

  seal(value: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
  }

  open(value: string, context: string): string {
    if (!value.startsWith("v1:")) throw new Error("Unsupported encrypted data format.");
    const bytes = Buffer.from(value.slice(3), "base64");
    if (bytes.length < 28) throw new Error("Invalid encrypted data.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  }

  authSecret(): string {
    return createHmac("sha256", this.key).update("applymate-auth-v1").digest("base64url");
  }
}

export async function loadCipher(directory: string, configuredKey?: string): Promise<Cipher> {
  if (configuredKey) {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(configuredKey)) throw new AppError(500, "KEY_FORMAT", "APPLYMATE_DATA_KEY must be a base64-encoded 32-byte key.");
    return new Cipher(Buffer.from(configuredKey, "base64"));
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "local-encryption.key");
  try { return new Cipher(await readFile(path)); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  try {
    await access(join(directory, "postgres"));
    throw new AppError(500, "KEY_MISSING", "This database has no local encryption key. Restore its original key or choose a new data directory; do not replace the key.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  try {
    await writeFile(path, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  return new Cipher(await readFile(path));
}
