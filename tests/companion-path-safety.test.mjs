import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const indexSource = await readFile(new URL("../companion/index.mjs", import.meta.url), "utf8");
const guardSource = await readFile(new URL("../companion/path-safety.mjs", import.meta.url), "utf8");

test("companion rejects lexical paths outside media root", () => {
  assert.match(guardSource, /export function safeTarget\(mediaRoot, relativePath\)/);
  assert.match(guardSource, /isInsideRoot\(mediaRoot, candidate\)/);
  assert.match(indexSource, /safeTarget\(mediaRoot, asset\.relativePath\)/);
});

test("companion resolves existing link-like path components before writes", () => {
  const guardStart = guardSource.indexOf("export async function assertSafeParent");
  const lstatIndex = guardSource.indexOf("await lstat(current)", guardStart);
  const realpathIndex = guardSource.indexOf("await realpath(current)", guardStart);
  const mkdirIndex = guardSource.indexOf("await mkdir(parent, { recursive: true })", guardStart);
  const resolvedParentIndex = guardSource.indexOf("await realpath(parent)", guardStart);

  assert.ok(guardStart >= 0, "assertSafeParent must exist");
  assert.ok(lstatIndex > guardStart, "existing path components must be lstat'ed");
  assert.ok(realpathIndex > lstatIndex, "link-like components must be resolved");
  assert.ok(mkdirIndex > realpathIndex, "link checks must occur before recursive mkdir");
  assert.ok(resolvedParentIndex > mkdirIndex, "resolved parent must be rechecked after mkdir");
});

test("companion rechecks parent immediately before atomic rename", () => {
  const downloadStart = indexSource.indexOf("async function downloadAndVerify");
  const writeIndex = indexSource.indexOf("createWriteStream(part)", downloadStart);
  const firstGuardIndex = indexSource.indexOf("await guardTarget(target)", downloadStart);
  const secondGuardIndex = indexSource.indexOf("await guardTarget(target)", writeIndex);
  const renameIndex = indexSource.indexOf("await rename(part, target)", secondGuardIndex);

  assert.ok(downloadStart >= 0);
  assert.ok(firstGuardIndex > downloadStart && firstGuardIndex < writeIndex, "guard must run before .part write");
  assert.ok(secondGuardIndex > writeIndex, "parent must be rechecked after download");
  assert.ok(renameIndex > secondGuardIndex, "final rename must occur only after the second guard");
});
