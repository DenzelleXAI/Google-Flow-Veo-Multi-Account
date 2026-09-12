import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql as sharedSql } from "../lib/db.ts";
import {
  OWNER_LOGIN_RATE_LIMIT,
  checkOwnerLoginRateLimit,
  clearOwnerLoginFailures,
  recordOwnerLoginFailure,
} from "../lib/owner-login-rate-limit.ts";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const previousSecret = process.env.APP_SESSION_SECRET;
process.env.APP_SESSION_SECRET = "owner-login-rate-limit-test-secret-abcdefghijklmnopqrstuvwxyz";

after(async () => {
  if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET;
  else process.env.APP_SESSION_SECRET = previousSecret;
  if (sharedSql) await sharedSql.end({ timeout: 1 });
});

test(
  "owner login limiter blocks the configured failure threshold and can be cleared",
  { skip: !hasDatabase },
  async () => {
    const clientAddress = `test-client-${randomUUID()}`;

    try {
      assert.deepEqual(await checkOwnerLoginRateLimit(clientAddress), {
        allowed: true,
        retryAfterSeconds: 0,
      });

      for (let attempt = 1; attempt < OWNER_LOGIN_RATE_LIMIT.maxFailures; attempt += 1) {
        const result = await recordOwnerLoginFailure(clientAddress);
        assert.equal(result.allowed, true, `failure ${attempt} should not block yet`);
      }

      const blocked = await recordOwnerLoginFailure(clientAddress);
      assert.equal(blocked.allowed, false);
      assert.ok(blocked.retryAfterSeconds > 0);

      const stillBlocked = await checkOwnerLoginRateLimit(clientAddress);
      assert.equal(stillBlocked.allowed, false);
      assert.ok(stillBlocked.retryAfterSeconds > 0);

      const leakedRawAddress = await sharedSql`
        select count(*)::int as count
        from owner_login_rate_limits
        where client_key = ${clientAddress}
      `;
      assert.equal(Number(leakedRawAddress[0]?.count ?? 0), 0, "raw client address must not be stored as the key");

      await clearOwnerLoginFailures(clientAddress);
      assert.deepEqual(await checkOwnerLoginRateLimit(clientAddress), {
        allowed: true,
        retryAfterSeconds: 0,
      });
    } finally {
      await clearOwnerLoginFailures(clientAddress).catch(() => undefined);
    }
  },
);
