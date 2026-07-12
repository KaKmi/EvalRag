import { INTENT_TABLE } from "@codecrush/contracts";
import { computeFingerprint, type FingerprintInput } from "../src/modules/applications/fingerprint";
import { buildSamples } from "../src/modules/applications/release-check.samples";

const base: FingerprintInput = {
  configVersionId: "v1",
  prompts: [
    { node: "rewrite", promptVersionId: "pr", contractVersion: 1 },
    { node: "intent", promptVersionId: "pi", contractVersion: 1 },
  ],
  models: [
    { node: "rewrite", modelId: "m1", providerRevision: "2026-07-12T00:00:00.000Z" },
    { node: "intent", modelId: "m1", providerRevision: "2026-07-12T00:00:00.000Z" },
  ],
  rerankModelId: null,
  rerankProviderRevision: null,
  nodeParams: { rewrite: { temperature: 0.7 } },
  retrievalParams: { topK: 20 },
  fallbackParams: { toHuman: true },
  kbs: [
    { kbId: "kb-b", activeVersion: 2, intentKey: null },
    { kbId: "kb-a", activeVersion: 1, intentKey: "SUPPORT" },
  ],
};

describe("computeFingerprint", () => {
  it("same input → same hash (64 hex)", () => {
    const a = computeFingerprint(base);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(computeFingerprint(base)).toBe(a);
  });
  it("kb ordering is irrelevant (stable sort)", () => {
    const reordered = { ...base, kbs: [...base.kbs].reverse() };
    expect(computeFingerprint(reordered)).toBe(computeFingerprint(base));
  });
  it("a changed KB active version changes the hash", () => {
    const changed = {
      ...base,
      kbs: [
        { kbId: "kb-a", activeVersion: 9, intentKey: "SUPPORT" },
        { kbId: "kb-b", activeVersion: 2, intentKey: null },
      ],
    };
    expect(computeFingerprint(changed)).not.toBe(computeFingerprint(base));
  });
  it("a changed KB intent binding changes the hash（014 P1-②：check→publish 窗口改绑定必失配）", () => {
    const rebindOther = {
      ...base,
      kbs: [
        { kbId: "kb-b", activeVersion: 2, intentKey: null },
        { kbId: "kb-a", activeVersion: 1, intentKey: "FEEDBACK" },
      ],
    };
    const unbind = {
      ...base,
      kbs: [
        { kbId: "kb-b", activeVersion: 2, intentKey: null },
        { kbId: "kb-a", activeVersion: 1, intentKey: null },
      ],
    };
    expect(computeFingerprint(rebindOther)).not.toBe(computeFingerprint(base));
    expect(computeFingerprint(unbind)).not.toBe(computeFingerprint(base));
  });
  it("a changed provider revision changes the hash", () => {
    const changed = {
      ...base,
      models: [
        { node: "rewrite", modelId: "m1", providerRevision: "2026-07-13T00:00:00.000Z" },
        { node: "intent", modelId: "m1", providerRevision: "2026-07-12T00:00:00.000Z" },
      ],
    };
    expect(computeFingerprint(changed)).not.toBe(computeFingerprint(base));
  });
});

describe("buildSamples", () => {
  it("rewrite/intent yield 10 samples; reply/fallback yield 1", () => {
    expect(buildSamples("rewrite")).toHaveLength(10);
    expect(buildSamples("intent")).toHaveLength(10);
    expect(buildSamples("reply")).toHaveLength(1);
    expect(buildSamples("fallback")).toHaveLength(1);
  });
  it("intent injects the full static INTENT_TABLE as availableIntents (014 D5: not derived from kbIds); reply gets citations:[]", () => {
    expect(buildSamples("intent")[0].runtimeContext).toEqual({
      availableIntents: INTENT_TABLE,
    });
    expect(buildSamples("reply")[0].runtimeContext).toEqual({ citations: [] });
  });
  it("reply input carries retrievalContext; fallback is fieldless plain text", () => {
    expect(buildSamples("reply")[0].input).toMatchObject({
      retrievalContext: expect.any(String),
    });
    expect(buildSamples("fallback")[0].input).toEqual({});
  });
});
