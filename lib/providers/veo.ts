import { GoogleGenAI, VideoGenerationReferenceType } from "@google/genai";

export type VeoImageInput = {
  bytes: Buffer;
  mimeType: string;
};

export type VeoGenerateInput = {
  apiKey: string;
  modelId: string;
  prompt: string;
  aspectRatio?: string | null;
  resolution?: string | null;
  initialFrame?: VeoImageInput | null;
  lastFrame?: VeoImageInput | null;
  referenceImages?: VeoImageInput[];
};

export function createVeoClient(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

function toSdkImage(image: VeoImageInput) {
  return {
    imageBytes: image.bytes.toString("base64"),
    mimeType: image.mimeType,
  };
}

export async function submitVeoGeneration(input: VeoGenerateInput) {
  const ai = createVeoClient(input.apiKey);
  const referenceImages = (input.referenceImages ?? []).map((image) => ({
    image: toSdkImage(image),
    referenceType: VideoGenerationReferenceType.ASSET,
  }));

  const operation = await ai.models.generateVideos({
    model: input.modelId,
    prompt: input.prompt,
    ...(input.initialFrame ? { image: toSdkImage(input.initialFrame) } : {}),
    config: {
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.resolution ? { resolution: input.resolution } : {}),
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
