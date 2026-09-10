import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { createAsset } from "@/lib/devices";
import { deleteRelayObject, uploadBufferToRelay } from "@/lib/r2";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const allowedAssetKinds = new Set(["REFERENCE_IMAGE", "INITIAL_FRAME", "LAST_FRAME"]);

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "reference-image";
}

export async function POST(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  let uploadedRelayKey: string | null = null;
  try {
    const form = await request.formData();
    const projectId = String(form.get("projectId") ?? "").trim();
    const rawFile = form.get("file");
    const type = String(form.get("type") ?? "REFERENCE_IMAGE").trim();

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!(rawFile instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!allowedAssetKinds.has(type)) {
      return NextResponse.json({ error: "Unsupported image asset type" }, { status: 400 });
    }
    if (!allowedTypes.has(rawFile.type)) {
      return NextResponse.json({ error: "Only PNG, JPEG, and WebP images are supported" }, { status: 415 });
    }
    if (rawFile.size <= 0 || rawFile.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image must be between 1 byte and 20 MB" }, { status: 413 });
    }

    const filename = safeFilename(rawFile.name);
    const buffer = Buffer.from(await rawFile.arrayBuffer());
    const objectKey = `inputs/${projectId}/${crypto.randomUUID()}-${filename}`;
    const relay = await uploadBufferToRelay({
      buffer,
      key: objectKey,
      contentType: rawFile.type,
    });
    uploadedRelayKey = relay.key;

    const asset = await createAsset({
      projectId,
      type,
      filename,
      mimeType: rawFile.type,
      r2Key: relay.key,
      sha256: relay.sha256,
      fileSizeBytes: relay.bytes,
    });
    uploadedRelayKey = null;

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    if (uploadedRelayKey) {
      await deleteRelayObject(uploadedRelayKey).catch((cleanupError) => {
        console.error("Failed to clean orphaned relay upload", cleanupError);
      });
    }
    console.error(error);
    return NextResponse.json({ error: "Failed to upload image asset" }, { status: 500 });
  }
}
