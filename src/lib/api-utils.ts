import { NextResponse } from "next/server";
import type { ApiResponse, ApiListResponse } from "./types";

export function successResponse<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ data }, { status });
}

export function listResponse<T>(
  data: T[],
  meta: { total: number; page: number; pageSize: number },
): NextResponse<ApiListResponse<T>> {
  return NextResponse.json({ data, meta });
}

export function errorResponse(
  code: string,
  message: string,
  status = 500,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}
