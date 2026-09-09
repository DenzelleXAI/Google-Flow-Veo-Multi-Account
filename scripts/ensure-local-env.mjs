import { access, copyFile } from "node:fs/promises";

try {
  await access(".env.local");
  console.log("Using existing .env.local");
} catch {
  await copyFile(".env.local.example", ".env.local");
  console.log("Created .env.local from .env.local.example");
}
