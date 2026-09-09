export const veoModels = {
  "veo-3.1-generate-preview": {
    label: "Veo 3.1",
    resolutions: ["720p", "1080p", "4k"],
    durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"],
    supportsImageToVideo: true,
    supportsLastFrame: true,
    supportsReferenceImages: true,
    maxReferenceImages: 3,
    supportsExtension: true,
  },
  "veo-3.1-fast-generate-preview": {
    label: "Veo 3.1 Fast",
    resolutions: ["720p", "1080p", "4k"],
    durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"],
    supportsImageToVideo: true,
    supportsLastFrame: true,
    supportsReferenceImages: true,
    maxReferenceImages: 3,
    supportsExtension: true,
  },
  "veo-3.1-lite-generate-preview": {
    label: "Veo 3.1 Lite",
    resolutions: ["720p", "1080p"],
    durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"],
    supportsImageToVideo: true,
    supportsLastFrame: true,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    supportsExtension: false,
  },
} as const;

export type VeoModelId = keyof typeof veoModels;

export function validateVeoSettings(input: {
  modelId: string;
  resolution?: string | null;
  durationSeconds?: number | null;
  aspectRatio?: string | null;
  hasInitialFrame?: boolean;
  hasLastFrame?: boolean;
  referenceImageCount?: number;
}) {
  if (!(input.modelId in veoModels)) return `Unsupported Veo model: ${input.modelId}`;
  const model = veoModels[input.modelId as VeoModelId];
  const resolution = input.resolution ?? "720p";
  const duration = input.durationSeconds ?? 8;
  const aspect = input.aspectRatio ?? "16:9";
  const referenceImageCount = input.referenceImageCount ?? 0;

  if (!(model.resolutions as readonly string[]).includes(resolution)) {
    return `${model.label} does not support ${resolution}.`;
  }
  if (!(model.durations as readonly number[]).includes(duration)) {
    return `${model.label} does not support ${duration}s generation.`;
  }
  if (!(model.aspectRatios as readonly string[]).includes(aspect)) {
    return `${model.label} does not support aspect ratio ${aspect}.`;
  }
  if ((resolution === "1080p" || resolution === "4k") && duration !== 8) {
    return `${resolution} generation requires an 8-second duration.`;
  }
  if (input.hasLastFrame && !input.hasInitialFrame) {
    return "A last frame requires an initial frame.";
  }
  if (input.hasLastFrame && !model.supportsLastFrame) {
    return `${model.label} does not support last-frame interpolation.`;
  }
  if (referenceImageCount > model.maxReferenceImages) {
    return model.supportsReferenceImages
      ? `${model.label} supports at most ${model.maxReferenceImages} reference images.`
      : `${model.label} does not support reference images.`;
  }
  if (referenceImageCount > 0 && duration !== 8) {
    return "Reference-image generation requires an 8-second duration.";
  }

  return null;
}
