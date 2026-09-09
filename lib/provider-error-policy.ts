export type ProviderSubmissionFailureKind = "final" | "retryable_rejected" | "ambiguous";

export type ProviderSubmissionFailure = {
  kind: ProviderSubmissionFailureKind;
  httpStatus: number | null;
  providerCode: string | null;
  message: string;
};

const blockedCodes = new Set([
  "safety",
  "recitation",
  "language",
  "prohibited_content",
  "spii",
  "blocklist",
  "image_safety",
  "image_prohibited_content",
  "image_recitation",
  "content_blocked",
]);

const finalCodes = new Set([
  "invalid_request",
  "failed_precondition",
  "out_of_range",
  "parameter_unknown",
  "authentication",
  "permission_denied",
  "not_found",
  "model_not_found",
  "unimplemented",
]);

const retryableRejectedCodes = new Set([
  "rate_limit_exceeded",
  "quota_exceeded",
  "too_many_requests",
  "aborted",
  "already_exists",
]);

function finiteStatus(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCode(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function extractProviderError(error: unknown) {
  const anyError = error as any;
  const nested = anyError?.error;
  const responseData = anyError?.response?.data?.error ?? anyError?.response?.data;

  const httpStatus =
    finiteStatus(anyError?.status) ??
    finiteStatus(anyError?.statusCode) ??
    finiteStatus(anyError?.response?.status) ??
    (typeof anyError?.code === "number" ? finiteStatus(anyError.code) : null) ??
    (typeof nested?.code === "number" ? finiteStatus(nested.code) : null) ??
    (typeof responseData?.code === "number" ? finiteStatus(responseData.code) : null);

  const providerCode =
    normalizeCode(typeof anyError?.code === "string" ? anyError.code : null) ??
    normalizeCode(anyError?.status) ??
    normalizeCode(nested?.code) ??
    normalizeCode(nested?.status) ??
    normalizeCode(responseData?.code) ??
    normalizeCode(responseData?.status) ??
    null;

  const message =
    (typeof anyError?.message === "string" && anyError.message) ||
    (typeof nested?.message === "string" && nested.message) ||
    (typeof responseData?.message === "string" && responseData.message) ||
    "Unknown provider submission error";

  return { httpStatus, providerCode, message };
}

export function classifyProviderSubmissionFailure(error: unknown): ProviderSubmissionFailure {
  const extracted = extractProviderError(error);
  const { httpStatus, providerCode } = extracted;

  if (providerCode && blockedCodes.has(providerCode)) {
    return { ...extracted, kind: "final" };
  }
  if (providerCode && finalCodes.has(providerCode)) {
    return { ...extracted, kind: "final" };
  }
  if (providerCode && retryableRejectedCodes.has(providerCode)) {
    return { ...extracted, kind: "retryable_rejected" };
  }

  if (httpStatus !== null) {
    if ([400, 401, 403, 404, 416, 501].includes(httpStatus)) {
      return { ...extracted, kind: "final" };
    }
    if ([409, 429].includes(httpStatus)) {
      return { ...extracted, kind: "retryable_rejected" };
    }

    // Timeouts, disconnects, and 5xx responses are deliberately treated as
    // ambiguous for paid video submission. Even when a generic API guide says
    // to retry, we cannot prove that the billable Veo operation was not already
    // accepted before the response was lost.
    if (httpStatus === 408 || httpStatus === 499 || httpStatus >= 500) {
      return { ...extracted, kind: "ambiguous" };
    }
  }

  // Unknown SDK/network errors are conservative by default: after the provider
  // call begins, lack of a definitive rejection means acceptance is uncertain.
  return { ...extracted, kind: "ambiguous" };
}
