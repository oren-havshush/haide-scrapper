import { NextResponse } from "next/server";
import type { ApiErrorResponse } from "./types";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super("NOT_FOUND", `${resource} with ID ${id} not found`, 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message, 400);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export class DuplicateSiteError extends ConflictError {
  constructor() {
    super("A site with this URL already exists");
    this.code = "DUPLICATE_SITE";
    this.name = "DuplicateSiteError";
  }
}

export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super("INVALID_TRANSITION", `Cannot transition from ${from} to ${to}`, 400);
    this.name = "InvalidTransitionError";
  }
}

/**
 * A Prisma unique-constraint violation (P2002).
 *
 * Duck-typed rather than checked with `instanceof`, so this file stays free of
 * a Prisma import — it is reached from route handlers on both sides of the
 * client/server boundary. `clientVersion` is what separates a real Prisma error
 * from any object that happens to carry a `code` of "P2002".
 *
 * It matters because it is a *conflict*, not a server fault: two writers raced
 * for the same row. Reported as a 500 it looks like a bug in the dashboard;
 * reported as 409 it reads as what it is, and the caller can retry. The nightly
 * sweep is the writer that makes this reachable — it competes with an operator
 * pressing Scrape on the same site.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; clientVersion?: unknown };
  return e.code === "P2002" && typeof e.clientVersion === "string";
}

export function formatErrorResponse(error: unknown): NextResponse<ApiErrorResponse> {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode },
    );
  }

  if (isUniqueConstraintError(error)) {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message: "That record already exists, or another request created it first.",
        },
      },
      { status: 409 },
    );
  }

  console.error("Unexpected error:", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
    { status: 500 },
  );
}
