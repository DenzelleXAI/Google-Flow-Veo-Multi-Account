import test from "node:test";
import assert from "node:assert/strict";
import {
  constantTimeTextEqual,
  createOwnerSessionToken,
  OWNER_SESSION_MAX_AGE_SECONDS,
  ownerAuthConfigured,
  verifyOwnerPassword,
  verifyOwnerSessionToken,
} from "../lib/owner-auth.ts";

test("constant-time text equality handles equal and unequal values", () => {
  assert.equal(constantTimeTextEqual("same-value", "same-value"), true);
  assert.equal(constantTimeTextEqual("same-value", "different"), false);
  assert.equal(constantTimeTextEqual("short", "shorter"), false);
});

test("owner session tokens are unique and secret-bound", async () => {
  const now = Date.UTC(2026, 8, 12, 0, 0, 0);
  const first = await createOwnerSessionToken("session-secret-1234567890", now);
  const second = await createOwnerSessionToken("session-secret-1234567890", now);
  const other = await createOwnerSessionToken("different-session-secret", now);
  assert.notEqual(first, second);
  assert.notEqual(first, other);
  assert.equal(first.split(".").length, 4);
});

test("configured owner password and signed session verify", async () => {
  const previousPassword = process.env.APP_ACCESS_PASSWORD;
  const previousSecret = process.env.APP_SESSION_SECRET;
  process.env.APP_ACCESS_PASSWORD = "owner-password-test";
  process.env.APP_SESSION_SECRET = "owner-session-secret-test-abcdefghijklmnopqrstuvwxyz";

  try {
    assert.equal(ownerAuthConfigured(), true);
    assert.equal(verifyOwnerPassword("owner-password-test"), true);
    assert.equal(verifyOwnerPassword("wrong-password"), false);

    const now = Date.UTC(2026, 8, 12, 0, 0, 0);
    const token = await createOwnerSessionToken(undefined, now);
    assert.equal(await verifyOwnerSessionToken(token, now), true);
    assert.equal(await verifyOwnerSessionToken(`${token}x`, now), false);

    const expiredAt = now + (OWNER_SESSION_MAX_AGE_SECONDS + 1) * 1000;
    assert.equal(await verifyOwnerSessionToken(token, expiredAt), false);
  } finally {
    if (previousPassword === undefined) delete process.env.APP_ACCESS_PASSWORD;
    else process.env.APP_ACCESS_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previousSecret;
  }
});

test("owner session rejects payload tampering and future-issued tokens", async () => {
  const previousPassword = process.env.APP_ACCESS_PASSWORD;
  const previousSecret = process.env.APP_SESSION_SECRET;
  process.env.APP_ACCESS_PASSWORD = "owner-password-test";
  process.env.APP_SESSION_SECRET = "owner-session-secret-test-abcdefghijklmnopqrstuvwxyz";

  try {
    const now = Date.UTC(2026, 8, 12, 0, 0, 0);
    const token = await createOwnerSessionToken(undefined, now);
    const [issuedAt, expiresAt, nonce, signature] = token.split(".");
    const tampered = `${issuedAt}.${Number(expiresAt) + 60}.${nonce}.${signature}`;
    assert.equal(await verifyOwnerSessionToken(tampered, now), false);

    const futureToken = await createOwnerSessionToken(undefined, now + 61_000);
    assert.equal(await verifyOwnerSessionToken(futureToken, now), false);
  } finally {
    if (previousPassword === undefined) delete process.env.APP_ACCESS_PASSWORD;
    else process.env.APP_ACCESS_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previousSecret;
  }
});
