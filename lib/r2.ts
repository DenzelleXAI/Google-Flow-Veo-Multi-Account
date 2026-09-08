import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

function requireR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 relay is not fully configured.");
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function createR2Client() {
  const config = requireR2Config();
  return {
    client: new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
    bucket: config.bucket,
  };
}

export async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
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
