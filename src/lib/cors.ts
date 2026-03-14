export function getCorsHeaders(origin: string | null): Record<string, string> {
  // Allow Chrome extension origins
  if (origin && origin.startsWith("chrome-extension://")) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    };
  }
  return {};
}

export function isExtensionOrigin(origin: string | null): boolean {
  return origin !== null && origin.startsWith("chrome-extension://");
}
