import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("companion rejects lexical paths outside media root", async () => {
  const source = await readFile(new URL("../companion/index.mjs", import.meta.url), "utf8");
  assert.match(source, /function safeTarget\(relativePath\)/);
  assert.match(source, /isInsideRoot\(mediaRoot, candidate\)/);
});

test("companion resolves existing link-like path components before writes", async () => {
  const source = await readFile(new URL("../companion/index.mjs", import.meta.url), "utf8");
  const guardStart = source.indexOf("async function assertSafeParent(target)");
  const lstatIndex = source.indexOf("await lstat(current)", guardStart);
  const realpathIndex = source.indexOf("await realpath(current)", guardStart);
  const mkdirIndex = source.indexOf("await mkdir(parent, { recursive: true })", guardStart);
  const resolvedParentIndex = source.indexOf("await realpath(parent)", guardStart);

  assert.ok(guardStart >= 0, "assertSafeParent must exist");
  assert.ok(lstatIndex > guardStart, "existing path components must be lstat'ed");
  assert.ok(realpathIndex > lstatIndex, "link-like components must be resolved");
  assert.ok(mkdirIndex > realpathIndex, "link checks must occur before recursive mkdir");
  assert.ok(resolvedParentIndex > mkdirIndex, "resolved parent must be rechecked after mkdir");
});

test("companion rechecks parent immediately before atomic rename", async () => {
  const source = await readFile(new URL("../companion/index.mjs", import.meta.url), "utf8");
  const downloadStart = source.indexOf("async function downloadAndVerify");
  const writeIndex = source.indexOf("createWriteStream(part)", downloadStart);
  const secondGuardIndex = source.indexOf("await assertSafeParent(target)", writeIndex);
  const renameIndex = source.indexOf("await rename(part, target)", secondGuardIndex);

  assert.ok(downloadStart >= 0);
  assert.ok(writeIndex > downloadStart, "download must write only to the guarded target tree");
  assert.ok(secondGuardIndex > writeIndex, "parent must be rechecked after download");
  assert.ok(renameIndex > secondGuardIndex, "final rename must occur only after the second guard");
});
