import { GoogleGenAI, VideoGenerationReferenceType } from "@google/genai";

export type VeoImageInput = {
  bytes: Buffer;
  mimeType: string;
};

export type VeoVideoInput = {
  bytes: Buffer;
  mimeType: string;
};

export type VeoGenerateInput = {
  apiKey: string;
  modelId: string;
  prompt: string;
  aspectRatio?: string | null;
  resolution?: string | null;
  durationSeconds?: number | null;
  initialFrame?: VeoImageInput | null;
  lastFrame?: VeoImageInput | null;
  referenceImages?: VeoImageInput[];
  extensionVideo?: VeoVideoInput | null;
};

export const PAID_VEO_HTTP_OPTIONS = {
  // @google/genai counts the initial request in `attempts`, so 1 means the
  // SDK itself performs zero retries around the non-idempotent paid submit.
  retryOptions: { attempts: 1 },
} as const;

export function createVeoClient(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

function toSdkImage(image: VeoImageInput) {
  return {
    imageBytes: image.bytes.toString("base64"),
    mimeType: image.mimeType,
  };
}

function toSdkVideo(video: VeoVideoInput) {
  return {
    videoBytes: video.bytes.toString("base64"),
    mimeType: video.mimeType,
  };
}

export async function submitVeoGeneration(input: VeoGenerateInput) {
  const ai = createVeoClient(input.apiKey);
  const referenceImages = (input.referenceImages ?? []).map((image) => ({
    image: toSdkImage(image),
    referenceType: VideoGenerationReferenceType.ASSET,
  }));
  const isExtension = Boolean(input.extensionVideo);

  const operation = await ai.models.generateVideos({
    model: input.modelId,
    ...(input.prompt.trim() ? { prompt: input.prompt } : {}),
    ...(input.initialFrame ? { image: toSdkImage(input.initialFrame) } : {}),
    ...(input.extensionVideo ? { video: toSdkVideo(input.extensionVideo) } : {}),
    config: {
      numberOfVideos: 1,
      httpOptions: PAID_VEO_HTTP_OPTIONS,
      ...(input.aspectRatio && !isExtension ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.resolution ? { resolution: input.resolution } : {}),
      ...(input.durationSeconds ? { durationSeconds: input.durationSeconds } : {}),
      ...(input.lastFrame ? { lastFrame: toSdkImage(input.lastFrame) } : {}),
      ...(referenceImages.length ? { referenceImages } : {}),
    },
  });

  return { ai, operation };
}

export async function pollVeoOperation(ai: GoogleGenAI, operation: any) {
  return ai.operations.getVideosOperation({ operation });
}

export async function downloadVeoVideo(ai: GoogleGenAI, operation: any, downloadPath: string) {
  const generatedVideo = operation?.response?.generatedVideos?.[0]?.video;
  if (!generatedVideo) throw new Error("Veo completed without a downloadable video.");

  await ai.files.download({ file: generatedVideo, downloadPath });
  return downloadPath;
}
