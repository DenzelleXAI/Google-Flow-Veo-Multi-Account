import { randomUUID } from "node:crypto";
import {
  createRelayDownloadUrl,
  deleteRelayObject,
  downloadRelayObject,
  sha256Buffer,
  uploadBufferToRelay,
} from "../lib/r2.ts";

const payload = Buffer.from(`Persistent AI Video Studio relay smoke ${Date.now()}`);
const key = `ci-smoke/${randomUUID()}.txt`;
const expectedHash = sha256Buffer(payload);

try {
  const uploaded = await uploadBufferToRelay({
    buffer: payload,
    key,
    contentType: "text/plain",
  });

  if (uploaded.sha256 !== expectedHash || uploaded.bytes !== payload.byteLength) {
    throw new Error("Relay upload metadata did not match the source payload.");
  }

  const direct = await downloadRelayObject(key);
  if (!direct.equals(payload)) {
    throw new Error("Relay direct readback did not match the uploaded payload.");
  }

  const signedUrl = await createRelayDownloadUrl(key, 60);
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`Signed relay URL returned ${response.status}.`);
  }
  const signedBytes = Buffer.from(await response.arrayBuffer());
  if (!signedBytes.equals(payload)) {
    throw new Error("Signed relay URL readback did not match the uploaded payload.");
  }

  console.log("Relay smoke test: OK");
  console.log(`OK  upload (${uploaded.bytes} bytes)`);
  console.log("OK  direct readback");
  console.log("OK  signed URL readback");
  console.log("OK  SHA-256 integrity");
} finally {
  await deleteRelayObject(key).catch(() => undefined);
}
