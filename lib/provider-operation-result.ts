export type VeoTerminalOperationFailure = {
  code: string;
  message: string;
};

function safeText(value: unknown, fallback: string, maxLength = 1200) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
}

export function getVeoTerminalOperationFailure(operation: any): VeoTerminalOperationFailure | null {
  if (!operation?.done) return null;

  if (operation.error) {
    const providerCode = operation.error.code === undefined || operation.error.code === null
      ? "unknown"
      : String(operation.error.code).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80);
    return {
      code: `PROVIDER_OPERATION_ERROR_${providerCode}`,
      message: safeText(operation.error.message, "Veo operation completed with a provider error."),
    };
  }

  const response = operation.response;
  const generatedVideos = Array.isArray(response?.generatedVideos) ? response.generatedVideos : [];
  if (generatedVideos.some((item: any) => Boolean(item?.video))) return null;

  const filteredCount = Number(response?.raiMediaFilteredCount ?? 0);
  const filteredReasons = Array.isArray(response?.raiMediaFilteredReasons)
    ? response.raiMediaFilteredReasons
        .filter((reason: unknown) => typeof reason === "string" && reason.trim())
        .map((reason: string) => reason.trim())
        .slice(0, 5)
    : [];

  if (filteredCount > 0 || filteredReasons.length > 0) {
    return {
      code: "PROVIDER_RAI_FILTERED",
      message: safeText(
        filteredReasons.join("; "),
        `Veo filtered ${Math.max(filteredCount, 1)} generated media result${Math.max(filteredCount, 1) === 1 ? "" : "s"}.`,
      ),
    };
  }

  return {
    code: "PROVIDER_EMPTY_RESULT",
    message: "Veo operation completed without a generated video.",
  };
}
