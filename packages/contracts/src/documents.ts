import { z } from "zod";

export const DocumentStatusSchema = z.enum(["upload", "ingest", "ready", "failed"]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentTypeSchema = z.enum(["pdf", "word", "markdown", "text"]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DocumentSchema = z.object({
  id: z.string().min(1),
  kbId: z.string().min(1),
  name: z.string().min(1),
  type: DocumentTypeSchema,
  size: z.number().int().nonnegative(),
  chunksCount: z.number().int().nonnegative(),
  status: DocumentStatusSchema,
  stage: z.string().optional(),
  error: z.string().nullable().optional(),
  blobKey: z.string().optional(),
  updatedAt: z.string().datetime(),
});
export type Document = z.infer<typeof DocumentSchema>;
