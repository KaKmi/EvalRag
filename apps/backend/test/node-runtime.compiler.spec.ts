import { renderTemplateStrict } from "../src/modules/node-runtime/compiler/render-strict";
import { assembleMessages } from "../src/modules/node-runtime/compiler/assemble";
import { REWRITE_CONTRACT } from "../src/modules/node-runtime/contracts/rewrite.contract";

// M8.0 Story 6：严格渲染（区别于 contracts 包宽松版 renderTemplate，注释明确
// "只适用于预览"）+ 三层消息组装（system 固定 + developer 渲染结果 + user JSON envelope）。

describe("renderTemplateStrict", () => {
  it("合法变量：正常替换", () => {
    expect(renderTemplateStrict("回答 {query}", { query: "q" }, "rewrite")).toBe("回答 q");
  });
  it("未知变量：抛错（严格渲染，区别于 contracts 包宽松版 renderTemplate）", () => {
    expect(() => renderTemplateStrict("{notAField}", {}, "rewrite")).toThrow();
  });
  it("保留字段：抛错", () => {
    expect(() => renderTemplateStrict("{availableRoutes}", {}, "intent")).toThrow();
  });
  it("多个合法变量：全部替换，未提供的变量用空串", () => {
    expect(renderTemplateStrict("{query} / {history}", { query: "q" }, "rewrite")).toBe("q / ");
  });
  it("其他节点的合法字段在本节点视角下仍是非法（如 reply 的 retrievalContext 用在 rewrite 上）", () => {
    expect(() => renderTemplateStrict("{retrievalContext}", {}, "rewrite")).toThrow();
  });
});

describe("assembleMessages", () => {
  it("三层顺序：system 固定 → developer 渲染结果 → user JSON envelope", () => {
    const messages = assembleMessages({
      contract: REWRITE_CONTRACT,
      promptBody: "改写：{query}",
      input: { query: "怎么退货", history: "" },
      reserved: {},
    });
    expect(messages[0]).toEqual({ role: "system", content: REWRITE_CONTRACT.systemInstructions });
    expect(messages[1]).toEqual({ role: "developer", content: "改写：怎么退货" });
    expect(messages[2].role).toBe("user");
    expect(JSON.parse(messages[2].content)).toEqual({ query: "怎么退货", history: "" });
  });

  it("user envelope 包含 input 与 reserved 的合并（reserved 字段一并透传给模型）", () => {
    const messages = assembleMessages({
      contract: REWRITE_CONTRACT,
      promptBody: "{query}",
      input: { query: "q", history: "h" },
      reserved: { extra: "x" },
    });
    expect(JSON.parse(messages[2].content)).toEqual({ query: "q", history: "h", extra: "x" });
  });

  it("恰好三条消息，顺序固定", () => {
    const messages = assembleMessages({
      contract: REWRITE_CONTRACT,
      promptBody: "{query}",
      input: { query: "q", history: "" },
      reserved: {},
    });
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.role)).toEqual(["system", "developer", "user"]);
  });
});
