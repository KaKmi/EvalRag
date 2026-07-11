import { describe, expect, it } from "vitest";
import type { PromptNodeVersionCandidate } from "@codecrush/contracts";
import { buildPromptVersionOptions } from "./AgentsPage";

// 012 Story 6：应用/旧 Agent 表单候选 = 节点下全部具体版本（平权），标签仅是排序/展示信号
const c = (over: Partial<PromptNodeVersionCandidate>): PromptNodeVersionCandidate => ({
  promptId: "p1",
  promptName: "回复生成-通用",
  versionId: "pv1",
  version: 1,
  tags: [],
  compileStatus: "ok",
  createdAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

describe("buildPromptVersionOptions", () => {
  it("包含无标签版本；带标签版本排前且 label 显示标签", () => {
    const opts = buildPromptVersionOptions(
      [
        c({ versionId: "pv3", version: 3 }),
        c({ versionId: "pv2", version: 2, tags: ["production"] }),
        c({ versionId: "pv1", version: 1 }),
      ],
      "",
    );
    expect(opts.map((o) => o.value)).toEqual(["pv2", "pv3", "pv1"]);
    expect(opts[0].label).toBe("回复生成-通用 v2（production）");
    expect(opts[1].label).toBe("回复生成-通用 v3");
  });

  it("稳定排序：同为带标签/无标签时保持后端顺序（name asc + version desc）", () => {
    const opts = buildPromptVersionOptions(
      [
        c({ promptName: "A", versionId: "a2", version: 2 }),
        c({ promptName: "A", versionId: "a1", version: 1 }),
        c({ promptName: "B", versionId: "b1", version: 1 }),
      ],
      "",
    );
    expect(opts.map((o) => o.value)).toEqual(["a2", "a1", "b1"]);
  });

  it("已绑定版本在候选中 → 不额外加兜底项", () => {
    const opts = buildPromptVersionOptions([c({ versionId: "pv1" })], "pv1");
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe("pv1");
  });

  it("已绑定版本不在候选（如已删）→ 补「沿用原引用版本」避免裸 UUID", () => {
    const opts = buildPromptVersionOptions([c({ versionId: "pv1" })], "gone-uuid");
    expect(opts[0]).toEqual({ value: "gone-uuid", label: "沿用原引用版本" });
    expect(opts).toHaveLength(2);
  });
});
