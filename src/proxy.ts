import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, isExtensionOrigin } from "@/lib/cors";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

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

  // SSE stream is accessed via EventSource which cannot set custom headers.
  const { pathname } = request.nextUrl;
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

  const token = authHeader.slice(7);
  const apiToken = process.env.API_TOKEN;

  if (!apiToken || !constantTimeEqual(token, apiToken)) {
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
