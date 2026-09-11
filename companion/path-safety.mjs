import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function isInsideRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function safeTarget(mediaRoot, relativePath) {
  const candidate = resolve(mediaRoot, String(relativePath).split("/").join(sep));
  if (!isInsideRoot(mediaRoot, candidate)) {
    throw new Error(`Unsafe media path: ${relativePath}`);
  }
  return candidate;
}

export async function resolveMediaRoot(mediaRoot) {
  await mkdir(mediaRoot, { recursive: true });
  return realpath(mediaRoot);
}

export async function assertSafeParent({ mediaRoot, mediaRootReal, target }) {
  const parent = dirname(target);
  if (!isInsideRoot(mediaRoot, parent)) {
    throw new Error(`Unsafe media parent: ${parent}`);
  }

  const rel = relative(mediaRoot, parent);
  const segments = rel === "" ? [] : rel.split(sep).filter(Boolean);
  let current = mediaRoot;

  for (const segment of segments) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        const resolvedLink = await realpath(current);
        if (!isInsideRoot(mediaRootReal, resolvedLink)) {
          throw new Error(`Unsafe symlink/junction escapes media root: ${current}`);
        }
      } else if (!info.isDirectory()) {
        throw new Error(`Media path component is not a directory: ${current}`);
      }
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }

  await mkdir(parent, { recursive: true });

  const resolvedParent = await realpath(parent);
  if (!isInsideRoot(mediaRootReal, resolvedParent)) {
    throw new Error(`Resolved media parent escapes configured root: ${parent}`);
  }

  return resolvedParent;
}
