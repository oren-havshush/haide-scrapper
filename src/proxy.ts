import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, isExtensionOrigin } from "@/lib/cors";
import { isAcceptedToken, parseApiTokens } from "@/lib/apiTokens";

function addCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  const corsHeaders = getCorsHeaders(origin);
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");

  // Handle CORS preflight requests from Chrome extension
  if (request.method === "OPTIONS" && isExtensionOrigin(origin)) {
    const response = new NextResponse(null, { status: 200 });
    return addCorsHeaders(response, origin);
  }

  const { pathname } = request.nextUrl;

  // Skip auth for health check (used by Docker healthcheck)
  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  // SSE stream is accessed via EventSource which cannot set custom headers.
  if (pathname === "/api/events" && request.method === "GET") {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const response = NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Missing or invalid authorization header" } },
      { status: 401 },
    );
    return addCorsHeaders(response, origin);
  }

  // API_TOKEN, or any secret listed in API_TOKENS (src/lib/apiTokens.ts).
  const token = authHeader.slice(7);

  if (!isAcceptedToken(token, parseApiTokens(process.env))) {
    const response = NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid API token" } },
      { status: 401 },
    );
    return addCorsHeaders(response, origin);
  }

  // For successful auth, add CORS headers to the response that passes through
  const response = NextResponse.next();
  return addCorsHeaders(response, origin);
}

export const config = {
  matcher: "/api/:path*",
};
