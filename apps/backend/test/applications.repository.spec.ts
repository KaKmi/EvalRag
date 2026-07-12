import { isUuid } from "../src/modules/applications/applications.repository";

// QA fix：findApplicationById 查询前用 isUuid 短路非 UUID 输入（如 slug），避免 Postgres
// uuid 类型列做原始比较时抛 22P02 类型转换错误、冒泡成裸 500（真实 Postgres 上验证；
// .ship/tasks/m8-t1-orchestration-kernel/qa/report.md 记录了修复前的复现证据）。
describe("isUuid", () => {
  it("接受合法 UUID（大小写不敏感）", () => {
    expect(isUuid("026c09f5-eb7a-4cd3-891c-d115c8d3fbe5")).toBe(true);
    expect(isUuid("026C09F5-EB7A-4CD3-891C-D115C8D3FBE5")).toBe(true);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("拒绝 slug 与其他非 UUID 字符串（findApplicationById 应短路而非查库）", () => {
    expect(isUuid("demo-aftersale")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("026c09f5-eb7a-4cd3-891c-d115c8d3fbe5x")).toBe(false); // 多一位
    expect(isUuid("026c09f5-eb7a-4cd3-891c-d115c8d3fbe")).toBe(false); // 少一位
    expect(isUuid("not-a-uuid-at-all")).toBe(false);
  });
});
