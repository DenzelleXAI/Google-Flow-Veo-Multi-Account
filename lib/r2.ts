import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function relayConfiguration() {
  const endpoint = env("R2_ENDPOINT");
  const accountId = env("R2_ACCOUNT_ID");
  const accessKeyId = env("R2_ACCESS_KEY_ID");
  const secretAccessKey = env("R2_SECRET_ACCESS_KEY");
  const bucket = env("R2_BUCKET");
  const region = env("R2_REGION") || "auto";
  const forcePathStyle = ["1", "true", "yes"].includes(env("R2_FORCE_PATH_STYLE").toLowerCase());

  const missing = [
    ...(!endpoint && !accountId ? ["R2_ENDPOINT or R2_ACCOUNT_ID"] : []),
    ...(!accessKeyId ? ["R2_ACCESS_KEY_ID"] : []),
    ...(!secretAccessKey ? ["R2_SECRET_ACCESS_KEY"] : []),
    ...(!bucket ? ["R2_BUCKET"] : []),
  ];

  return {
    ready: missing.length === 0,
    missing,
    endpoint: endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ""),
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    region,
    forcePathStyle,
    mode: endpoint ? "custom" : "cloudflare",
  } as const;
}

function requireR2Config() {
  const config = relayConfiguration();
  if (!config.ready) {
    throw new Error(`R2/S3 relay is not fully configured. Missing: ${config.missing.join(", ")}.`);
  }
  return config;
}

export function createR2Client() {
  const config = requireR2Config();
  return {
    client: new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
    bucket: config.bucket,
  };
}

export async function createRelayDownloadUrl(key: string, expiresInSeconds = 900) {
  const { client, bucket } = createR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

export async function deleteRelayObject(key: string) {
  const { client, bucket } = createR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function sha256Buffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function uploadBufferToRelay(input: {
  buffer: Buffer;
  key: string;
  contentType: string;
}) {
  const { client, bucket } = createR2Client();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    Body: input.buffer,
    ContentType: input.contentType,
  }));

  return {
    key: input.key,
    bytes: input.buffer.byteLength,
    sha256: sha256Buffer(input.buffer),
  };
}

export async function downloadRelayObject(key: string) {
  const { client, bucket } = createR2Client();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`R2 object ${key} has no body.`);
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function uploadVideoToRelay(input: { path: string; key: string; contentType?: string }) {
  const { client, bucket } = createR2Client();
  const fileStat = await stat(input.path);
  const uploader = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: input.key,
      Body: createReadStream(input.path),
      ContentType: input.contentType ?? "video/mp4",
    },
  });

  await uploader.done();
  return {
    key: input.key,
    bytes: fileStat.size,
    sha256: await sha256File(input.path),
  };
}
