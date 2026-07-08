import { describe, expect, it } from "vitest";
import { PROTOCOLS_BY_TYPE, type ModelType } from "@codecrush/contracts";
import { PROTOCOL_OPTIONS } from "./models";

describe("PROTOCOL_OPTIONS 与契约 PROTOCOLS_BY_TYPE 一致", () => {
  it("每类的协议候选集合与契约完全一致（UI 不多不少）", () => {
    for (const type of Object.keys(PROTOCOLS_BY_TYPE) as ModelType[]) {
      const ui = PROTOCOL_OPTIONS[type].map((o) => o.protocol).sort();
      const contract = [...PROTOCOLS_BY_TYPE[type]].sort();
      expect(ui).toEqual(contract);
    }
  });
});
