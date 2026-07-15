export function checkOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin') ?? request.headers.get('Referer');
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.origin === process.env.ALLOWED_ORIGIN;
  } catch {
    return false;
  }
}
