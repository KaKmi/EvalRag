import { describe, expect, it } from "vitest";
import {
  ChunkSchema,
  ChunkPageResponseSchema,
  ChunkBatchDeleteRequestSchema,
} from "./chunks";
import {
  DocumentSchema,
  DocumentStatusSchema,
  UpdateDocumentMetadataRequestSchema,
} from "./documents";

const validChunk = {
  id: "c1",
  docId: "d1",
  kbId: "kb1",
  version: 1,
  seq: 0,
  text: "hello",
  tokenCount: 1,
  section: "intro",
};

describe("ChunkSchema", () => {
  it("accepts a valid chunk with version, rejects legacy enabled field silently (stripped)", () => {
    const parsed = ChunkSchema.parse({ ...validChunk, enabled: true });
    expect(parsed).not.toHaveProperty("enabled");
    expect(parsed.version).toBe(1);
  });
  it("rejects missing version", () => {
    const { version: _version, ...rest } = validChunk;
    expect(() => ChunkSchema.parse(rest)).toThrow();
  });
});

describe("ChunkPageResponseSchema", () => {
  it("accepts a paginated page", () => {
    const page = ChunkPageResponseSchema.parse({
      items: [validChunk],
      total: 1,
      offset: 0,
      limit: 20,
      hasMore: false,
    });
    expect(page.items.length).toBe(1);
  });
});

describe("ChunkBatchDeleteRequestSchema", () => {
  it("rejects an empty ids array", () => {
    expect(() => ChunkBatchDeleteRequestSchema.parse({ ids: [] })).toThrow();
  });
  it("accepts one or more ids", () => {
    expect(ChunkBatchDeleteRequestSchema.parse({ ids: ["c1", "c2"] }).ids.length).toBe(2);
  });
});

const validDocument = {
  id: "d1",
  kbId: "kb1",
  name: "a.pdf",
  type: "pdf" as const,
  size: 1024,
  chunksCount: 0,
  chunkVersion: null,
  status: "pending" as const,
  metadata: {},
  uploadedAt: "2026-07-08T00:00:00.000Z",
  updatedAt: "2026-07-08T00:00:00.000Z",
};

describe("DocumentStatusSchema", () => {
  it("accepts the five M4 statuses", () => {
    for (const s of ["pending", "queued", "processing", "failed", "ready"]) {
      expect(DocumentStatusSchema.parse(s)).toBe(s);
    }
  });
  it("rejects legacy M2 statuses", () => {
    expect(() => DocumentStatusSchema.parse("upload")).toThrow();
    expect(() => DocumentStatusSchema.parse("ingest")).toThrow();
  });
});

describe("DocumentSchema", () => {
  it("accepts a valid document with metadata and nullable chunkVersion", () => {
    expect(DocumentSchema.parse(validDocument)).toEqual(validDocument);
  });
});

describe("UpdateDocumentMetadataRequestSchema", () => {
  it("accepts a string->string metadata map", () => {
    expect(
      UpdateDocumentMetadataRequestSchema.parse({ metadata: { author: "x" } }).metadata.author,
    ).toBe("x");
  });
});
