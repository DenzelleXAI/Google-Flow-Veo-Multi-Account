import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSafeParent,
  resolveMediaRoot,
  safeTarget,
} from "../companion/path-safety.mjs";

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), "pavs-path-safety-"));
  const mediaRoot = join(base, "media");
  const outside = join(base, "outside");
  await mkdir(mediaRoot, { recursive: true });
  await mkdir(outside, { recursive: true });
  const mediaRootReal = await resolveMediaRoot(mediaRoot);
  return { base, mediaRoot, mediaRootReal, outside };
}

async function cleanup(base) {
  await rm(base, { recursive: true, force: true });
}

test("safeTarget rejects lexical traversal outside media root", async () => {
  const fixture = await makeFixture();
  try {
    assert.throws(
      () => safeTarget(fixture.mediaRoot, "../../escape.mp4"),
      /Unsafe media path/,
    );
  } finally {
    await cleanup(fixture.base);
  }
});

test("assertSafeParent rejects a symlink or junction that escapes media root", async (t) => {
  const fixture = await makeFixture();
  try {
    const link = join(fixture.mediaRoot, "escape-link");
    try {
      await symlink(
        fixture.outside,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error?.code)) {
        t.skip(`Windows runner does not allow creating junctions: ${error.code}`);
        return;
      }
      throw error;
    }

    const target = safeTarget(fixture.mediaRoot, "escape-link/generated/video.mp4");
    await assert.rejects(
      () => assertSafeParent({
        mediaRoot: fixture.mediaRoot,
        mediaRootReal: fixture.mediaRootReal,
        target,
      }),
      /escapes media root|escapes configured root/,
    );
  } finally {
    await cleanup(fixture.base);
  }
});

test("assertSafeParent allows and creates normal in-root parents", async () => {
  const fixture = await makeFixture();
  try {
    const target = safeTarget(fixture.mediaRoot, "workspace/outputs/job/asset.mp4");
    const resolvedParent = await assertSafeParent({
      mediaRoot: fixture.mediaRoot,
      mediaRootReal: fixture.mediaRootReal,
      target,
    });
    assert.match(resolvedParent, /workspace/);
  } finally {
    await cleanup(fixture.base);
  }
});
