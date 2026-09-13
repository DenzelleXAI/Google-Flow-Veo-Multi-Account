import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import {
  assertSafeParent,
  resolveMediaRoot,
  safeTarget,
} from "../companion/path-safety.mjs";

const indexSource = await readFile(new URL("../companion/index.mjs", import.meta.url), "utf8");
const guardSource = await readFile(new URL("../companion/path-safety.mjs", import.meta.url), "utf8");

test("companion rejects lexical paths outside media root", async () => {
  const base = await mkdtemp(join(os.tmpdir(), "pavs-path-lexical-"));
  const mediaRoot = join(base, "media");
  try {
    await mkdir(mediaRoot, { recursive: true });
    assert.throws(
      () => safeTarget(mediaRoot, "../outside/video.mp4"),
      /Unsafe media path/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("companion rejects a real symlink or Windows junction escaping media root", async () => {
  const base = await mkdtemp(join(os.tmpdir(), "pavs-path-link-"));
  const mediaRoot = join(base, "media");
  const outsideRoot = join(base, "outside");
  const escapeLink = join(mediaRoot, "escape");

  try {
    await mkdir(mediaRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    const mediaRootReal = await resolveMediaRoot(mediaRoot);

    // `junction` avoids Windows developer-mode/admin requirements. On POSIX,
    // a directory symlink exercises the same realpath containment boundary.
    await symlink(
      outsideRoot,
      escapeLink,
      process.platform === "win32" ? "junction" : "dir",
    );

    const target = safeTarget(mediaRoot, "escape/nested/video.mp4");
    await assert.rejects(
      assertSafeParent({ mediaRoot, mediaRootReal, target }),
      /escapes media root|escapes configured root/,
    );

    // The guard must fail before recursive mkdir can create anything through
    // the escaping link/junction.
    await assert.rejects(stat(join(outsideRoot, "nested")), (error) => error?.code === "ENOENT");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
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
