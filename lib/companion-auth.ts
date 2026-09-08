export function requireCompanionToken(request: Request) {
  const expected = process.env.COMPANION_TOKEN;
  if (!expected) {
    throw new Error("COMPANION_TOKEN is not configured on the server.");
  }

  const received = request.headers.get("x-companion-token");
  if (!received || received !== expected) {
    const error = new Error("Unauthorized companion request.");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
}
