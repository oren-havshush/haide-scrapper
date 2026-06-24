import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { scanUrlForPolicy } from "@/services/policyReviewService";
import { z } from "zod";

const schema = z.object({
  url: z.string().url("Must be a valid URL"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = schema.parse(body);
    const result = await scanUrlForPolicy(url);
    return successResponse(result, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
