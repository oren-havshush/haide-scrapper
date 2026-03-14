import { z } from "zod";

export const createSiteSchema = z.object({
  siteUrl: z.url(),
});

export const updateSiteSchema = z.object({
  status: z.enum(["ANALYZING", "REVIEW", "ACTIVE", "FAILED", "SKIPPED"]).optional(),
  fieldMappings: z.record(z.string(), z.unknown()).optional(),
  pageFlow: z.array(z.unknown()).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const siteUrlFilterSchema = z.object({
  siteUrl: z.string().optional(),
});

export const sortSchema = z.object({
  sortBy: z.enum(["createdAt", "confidenceScore", "reviewAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const updateSiteStatusSchema = z.object({
  status: z.enum(["ANALYZING", "REVIEW", "ACTIVE", "FAILED", "SKIPPED"]),
});

export const jobsFilterSchema = z.object({
  siteId: z.string().optional(),
  scrapeRunId: z.string().optional(),
  validationStatus: z.enum(["valid", "invalid"]).optional(),
});

export const updateSiteConfigSchema = z.object({
  listingSelector: z.string().optional(),
  itemSelector: z.string().optional(),
  revealSelector: z.string().optional(),
  fieldMappings: z.record(z.string(), z.unknown()),
  pageFlow: z.array(z.object({
    url: z.string(),
    action: z.string(),
    waitFor: z.string().optional(),
  })),
  formCapture: z.object({
    formSelector: z.string(),
    actionUrl: z.string(),
    method: z.string(),
    fields: z.array(z.object({
      name: z.string(),
      label: z.string(),
      fieldType: z.string(),
      required: z.boolean(),
      tagName: z.string(),
    })),
  }).nullable(),
  originalMappings: z.record(z.string(), z.unknown()).optional(),
});
