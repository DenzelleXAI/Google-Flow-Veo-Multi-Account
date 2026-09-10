import test from "node:test";
import assert from "node:assert/strict";
import { isStateChangingMethod, isTrustedBrowserMutation } from "../lib/owner-request-security.ts";

test("safe/read methods are not blocked by mutation guard", () => {
  assert.equal(isStateChangingMethod("GET"), false);
  assert.equal(isStateChangingMethod("HEAD"), false);
  assert.equal(isTrustedBrowserMutation({
    method: "GET",
    requestOrigin: "https://studio.example.com",
    originHeader: null,
    secFetchSite: null,
    production: true,
  }), true);
});

test("production mutation requires exact same Origin", () => {
  const base = {
    method: "POST",
    requestOrigin: "https://studio.example.com",
    secFetchSite: "same-origin",
    production: true,
  };

  assert.equal(isTrustedBrowserMutation({ ...base, originHeader: "https://studio.example.com" }), true);
  assert.equal(isTrustedBrowserMutation({ ...base, originHeader: "https://evil.example" }), false);
  assert.equal(isTrustedBrowserMutation({ ...base, originHeader: null }), false);
  assert.equal(isTrustedBrowserMutation({ ...base, originHeader: "not-a-url" }), false);
});

test("cross-site fetch metadata is rejected even with spoof-like origin combination", () => {
  assert.equal(isTrustedBrowserMutation({
    method: "DELETE",
    requestOrigin: "https://studio.example.com",
    originHeader: "https://studio.example.com",
    secFetchSite: "cross-site",
    production: true,
  }), false);
});

test("local development does not require browser Origin", () => {
  assert.equal(isTrustedBrowserMutation({
    method: "PATCH",
    requestOrigin: "http://localhost:3000",
    originHeader: null,
    secFetchSite: null,
    production: false,
  }), true);
});
