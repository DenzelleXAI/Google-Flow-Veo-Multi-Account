import test from "node:test";
import assert from "node:assert/strict";
import { getVeoTerminalOperationFailure } from "../lib/provider-operation-result.ts";

test("unfinished Veo operation has no terminal failure", () => {
  assert.equal(getVeoTerminalOperationFailure({ done: false }), null);
});

test("completed provider error is terminal", () => {
  assert.deepEqual(
    getVeoTerminalOperationFailure({ done: true, error: { code: 13, message: "Provider internal failure" } }),
    { code: "PROVIDER_OPERATION_ERROR_13", message: "Provider internal failure" },
  );
});

test("RAI-filtered completed operation is terminal", () => {
  const result = getVeoTerminalOperationFailure({
    done: true,
    response: {
      generatedVideos: [],
      raiMediaFilteredCount: 1,
      raiMediaFilteredReasons: ["Generated media was filtered."],
    },
  });
  assert.deepEqual(result, {
    code: "PROVIDER_RAI_FILTERED",
    message: "Generated media was filtered.",
  });
});

test("empty completed response is terminal", () => {
  assert.deepEqual(
    getVeoTerminalOperationFailure({ done: true, response: { generatedVideos: [] } }),
    { code: "PROVIDER_EMPTY_RESULT", message: "Veo operation completed without a generated video." },
  );
});

test("completed operation with a video proceeds to relay", () => {
  assert.equal(
    getVeoTerminalOperationFailure({
      done: true,
      response: { generatedVideos: [{ video: { uri: "provider://video" } }] },
    }),
    null,
  );
});
