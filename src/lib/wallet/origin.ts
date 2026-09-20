/**
 * The host the browser used to reach this server. The connect statement names
 * it so a signature collected on another site cannot establish a session here.
 */
export function requestDomain(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const host = request.headers.get("host");
  if (host) return host.trim();
  return new URL(request.url).host;
}
