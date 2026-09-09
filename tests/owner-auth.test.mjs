import test from "node:test";
import assert from "node:assert/strict";
import {
  constantTimeTextEqual,
  createOwnerSessionToken,
  ownerAuthConfigured,
  verifyOwnerPassword,
  verifyOwnerSessionToken,
} from "../lib/owner-auth.ts";

test("constant-time text equality handles equal and unequal values", () => {
  assert.equal(constantTimeTextEqual("same-value", "same-value"), true);
  assert.equal(constantTimeTextEqual("same-value", "different"), false);
  assert.equal(constantTimeTextEqual("short", "shorter"), false);
});

test("owner session token is deterministic for one secret", async () => {
  const first = await createOwnerSessionToken("session-secret-1234567890");
  const second = await createOwnerSessionToken("session-secret-1234567890");
  const other = await createOwnerSessionToken("different-session-secret");
  assert.equal(first, second);
  assert.notEqual(first, other);
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

    const token = await createOwnerSessionToken();
    assert.equal(await verifyOwnerSessionToken(token), true);
    assert.equal(await verifyOwnerSessionToken(`${token}x`), false);
  } finally {
    if (previousPassword === undefined) delete process.env.APP_ACCESS_PASSWORD;
    else process.env.APP_ACCESS_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previousSecret;
  }
});
