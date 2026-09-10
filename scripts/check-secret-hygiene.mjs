import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const violations = [];

const credentialPatterns = [
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/g],
  ["GitHub token", /gh(?:p|o|u|s|r)_[A-Za-z0-9_]{20,}/g],
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["Anthropic secret", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["Private key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

function isAllowedEnvTemplate(file) {
  return file === ".env.example" || /^\.env(?:\.[A-Za-z0-9_-]+)*\.example$/.test(file);
}

function report(path, line, kind) {
  violations.push({ path, line, kind });
}

for (const path of tracked) {
  const file = basename(path);
  if ((file === ".env" || file.startsWith(".env.")) && !isAllowedEnvTemplate(file)) {
    report(path, 1, "tracked environment file");
    continue;
  }

  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    continue;
  }

  for (const [kind, pattern] of credentialPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const line = text.slice(0, match.index).split("\n").length;
      report(path, line, kind);
    }
  }
}

if (violations.length) {
  console.error("Secret hygiene check failed. Potential tracked credentials were detected.");
  for (const item of violations) {
    console.error(`- ${item.path}:${item.line} (${item.kind})`);
  }
  console.error("Values are intentionally not printed. Remove/rotate any real secret before continuing.");
  process.exit(1);
}

console.log(`Secret hygiene check passed across ${tracked.length} tracked files.`);
