import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured.");

  const candidates = [
    () => Buffer.from(raw, "base64"),
    () => Buffer.from(raw, "hex"),
    () => Buffer.from(raw, "utf8"),
  ];

  for (const make of candidates) {
    const key = make();
    if (key.length === 32) return key;
  }

  throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes.");
}

export function encryptCredential(plaintext: string) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptCredential(payload: string) {
  const [version, ivPart, tagPart, ciphertextPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Encrypted credential format is invalid.");
  }

  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
