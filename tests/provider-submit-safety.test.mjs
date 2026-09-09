import test from "node:test";
import assert from "node:assert/strict";
import { PAID_VEO_HTTP_OPTIONS } from "../lib/providers/veo.ts";

test("paid Veo submission allows exactly one SDK HTTP attempt", () => {
  assert.equal(PAID_VEO_HTTP_OPTIONS.retryOptions.attempts, 1);
});
