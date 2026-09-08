import { GoogleGenAI } from "@google/genai";

export type VeoGenerateInput = {
  apiKey: string;
  modelId: string;
  prompt: string;
  aspectRatio?: string | null;
  resolution?: string | null;
};

export function createVeoClient(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

export async function submitVeoGeneration(input: VeoGenerateInput) {
  const ai = createVeoClient(input.apiKey);
  const operation = await ai.models.generateVideos({
    model: input.modelId,
    prompt: input.prompt,
    config: {
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.resolution ? { resolution: input.resolution } : {}),
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
