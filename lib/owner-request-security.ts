const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isStateChangingMethod(method: string) {
  return stateChangingMethods.has(method.toUpperCase());
}

export function isTrustedBrowserMutation(input: {
  method: string;
  requestOrigin: string;
  originHeader?: string | null;
  secFetchSite?: string | null;
  production: boolean;
}) {
  if (!isStateChangingMethod(input.method)) return true;
  if (!input.production) return true;

  // Modern browser fetch/XHR requests include Origin for state-changing API
  // requests. Require it in production instead of treating a missing Origin as
  // implicitly trusted. Companion and Inngest machine routes bypass this guard
  // before owner-session handling and use their own authentication.
  if (!input.originHeader) return false;

  let suppliedOrigin: string;
  try {
    suppliedOrigin = new URL(input.originHeader).origin;
  } catch {
    return false;
  }

  if (suppliedOrigin !== input.requestOrigin) return false;

  // `same-origin` is the expected browser signal. Some clients omit
  // Sec-Fetch-Site, so Origin remains the authoritative check.
  if (input.secFetchSite && input.secFetchSite !== "same-origin" && input.secFetchSite !== "none") {
    return false;
  }

  return true;
}
