import { describe, expect, it } from "vitest";
import {
  ApplicationChatResultSchema,
  ApplicationConfigFieldsSchema,
  ApplicationSchema,
  CreateApplicationRequestSchema,
  UpdateApplicationRequestSchema,
} from "./applications";

const node = {
  promptVersionId: "prompt-version",
  modelId: "model",
  freedom: "balance" as const,
  temperature: 0.7,
  topP: 0.9,
};
const config = {
  kbIds: ["kb"],
  nodes: { rewrite: node, intent: node, reply: node, fallback: node },
  retrieval: {
    schemaVersion: 1 as const,
    topK: 20,
    topN: 5,
    hybridEnabled: true,
    vectorWeight: 0.7,
    rerankEnabled: false,
  },
  fallback: { toHuman: true },
};

describe("application contracts", () => {
  it("accepts a complete immutable configuration", () => {
    expect(ApplicationConfigFieldsSchema.parse(config)).toEqual(config);
  });

  it("enforces retrieval cross-field constraints", () => {
    expect(() =>
      ApplicationConfigFieldsSchema.parse({
        ...config,
        retrieval: { ...config.retrieval, topK: 4, topN: 5 },
      }),
    ).toThrow();
    expect(() =>
      ApplicationConfigFieldsSchema.parse({
        ...config,
        retrieval: { ...config.retrieval, rerankEnabled: true },
      }),
    ).toThrow();
    expect(() =>
      ApplicationConfigFieldsSchema.parse({
        ...config,
        retrieval: { ...config.retrieval, topK: 0 },
      }),
    ).toThrow();
    expect(() =>
      ApplicationConfigFieldsSchema.parse({
        ...config,
        retrieval: { ...config.retrieval, vectorWeight: 1.1 },
      }),
    ).toThrow();
    expect(() =>
      ApplicationConfigFieldsSchema.parse({
        ...config,
        retrieval: { ...config.retrieval, schemaVersion: 2 },
      }),
    ).toThrow();
  });

  it("enforces node and complete-config boundaries", () => {
    expect(() =>
      ApplicationConfigFieldsSchema.parse({
        ...config,
        nodes: { ...config.nodes, reply: { ...node, temperature: 2.1 } },
      }),
    ).toThrow();
    expect(() =>
      ApplicationConfigFieldsSchema.parse({
        ...config,
        nodes: { ...config.nodes, reply: { ...node, topP: 1.1 } },
      }),
    ).toThrow();
    expect(() => ApplicationConfigFieldsSchema.parse({ ...config, kbIds: [] })).toThrow();
    expect(() =>
      ApplicationConfigFieldsSchema.parse({
        ...config,
        nodes: { ...config.nodes, summary: node },
      }),
    ).toThrow();
  });

  it("requires a valid slug and complete v1 config", () => {
    expect(CreateApplicationRequestSchema.parse({ slug: "after-sale", name: "售后", config })).toMatchObject({
      description: "",
    });
    expect(() => CreateApplicationRequestSchema.parse({ slug: "A", name: "售后", config })).toThrow();
    expect(() => CreateApplicationRequestSchema.parse({ slug: "after-sale", name: "售后" })).toThrow();
  });

  it("keeps base updates strict", () => {
    expect(UpdateApplicationRequestSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(() => UpdateApplicationRequestSchema.parse({ slug: "new-slug" })).toThrow();
  });

  it("supports an application with no production pointer", () => {
    const value = {
      id: "application",
      slug: "after-sale",
      name: "售后",
      description: "",
      enabled: true,
      productionVersion: null,
      productionConfigVersionId: null,
      latestVersion: 1,
      versionCount: 1,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      updatedBy: "admin",
      createdBy: "admin",
    };
    expect(ApplicationSchema.parse(value)).toEqual(value);
  });

  it("defines the M7a chat placeholder", () => {
    expect(
      ApplicationChatResultSchema.parse({
        mode: "unavailable",
        reason: "pending_orchestration",
      }),
    ).toEqual({ mode: "unavailable", reason: "pending_orchestration" });
    expect(() => ApplicationChatResultSchema.parse({ mode: "text", text: "premature" })).toThrow();
    expect(() => ApplicationChatResultSchema.parse({ mode: "unknown" })).toThrow();
  });
});
