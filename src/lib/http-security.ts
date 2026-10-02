export function requireSameOrigin(request: Request): void {
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error('APP_URL is not configured.');
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(appUrl).origin) {
    throw new Error('Request origin is not allowed.');
  }
}
