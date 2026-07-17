import type { ImportEvalCasesRequest, ImportEvalCasesResponse } from "@codecrush/contracts";

/**
 * CSV 在前端解析（018 决策 D13：后端无文件上传基建，且 contracts 只依赖 zod → multipart
 * 无法用 Zod DTO 表达）。本文件只做「行 → 可入库用例 / 错误回执」的纯函数转换，不引新依赖。
 * 错误文案逐字取自原型 §19.1。
 */

export interface ParsedImportRow {
  question: string;
  goldPoints: string[];
  goldDocIds: string[];
  tags: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ImportParseResult {
  valid: Array<{ row: number; parsed: ParsedImportRow }>;
  errors: ImportEvalCasesResponse["errors"];
}

/** gold 答案按「要点」分号分隔（原型 §5「按要点分号分隔，判分按要点比对」）；全角/半角分号都认。 */
export function splitGoldPoints(goldAnswer: string): string[] {
  return goldAnswer
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 逗号分隔的单元格（全角/半角逗号都认）——tags 与 gold_docs 共用。 */
function splitList(cell: string | undefined): string[] {
  return (cell ?? "")
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseImportRows(rows: ImportEvalCasesRequest["rows"]): ImportParseResult {
  const valid: ImportParseResult["valid"] = [];
  const errors: ImportParseResult["errors"] = [];
  rows.forEach((raw, index) => {
    const row = index + 1;
    if (!raw.question?.trim()) {
      errors.push({ row, message: `第 ${row} 行缺少 question` });
      return;
    }
    if (raw.question.trim().length > 500) {
      // §19.1 用例编辑「问题 1-500 字」——导入走同一字段约束
      errors.push({ row, message: `第 ${row} 行问题不超过 500 字` });
      return;
    }
    if (!raw.goldAnswer?.trim()) {
      errors.push({ row, message: `第 ${row} 行缺少 gold_answer` });
      return;
    }
    const goldPoints = splitGoldPoints(raw.goldAnswer);
    // 纯分隔符（如 `;;;`）能过上面的非空检查却切不出任何要点 —— 放进去会得到一条永远
    // 无法「审核通过」（§19.1 要求 ≥1 要点）因而永远进不了 run 的僵尸用例，却回执成功。
    if (goldPoints.length === 0) {
      errors.push({ row, message: `第 ${row} 行缺少 gold_answer` });
      return;
    }
    if (goldPoints.some((p) => p.length > 200)) {
      errors.push({ row, message: `第 ${row} 行 gold 要点超过 200 字` });
      return;
    }
    // 原型 §5 CSV 模板列含 gold_docs（可空）；不解析 = 用户填了也静默丢失，故逐条校验。
    // 非法 uuid 必须在这里拦掉：goldDocIds 是 uuid[] 列，脏值会让整批 insert 抛 PG 错误。
    const goldDocIds = splitList(raw.goldDocs);
    if (goldDocIds.length > 10) {
      errors.push({ row, message: `第 ${row} 行最多关联 10 个片段` }); // §19.1「最多关联 10 个片段」
      return;
    }
    if (goldDocIds.some((id) => !UUID.test(id))) {
      errors.push({ row, message: `第 ${row} 行 gold_docs 含非法片段 id` });
      return;
    }
    const tags = splitList(raw.tags);
    if (tags.length > 5 || tags.some((t) => t.length > 12)) {
      errors.push({ row, message: `第 ${row} 行标签不合法（最多 5 个、每个 ≤12 字）` });
      return;
    }
    valid.push({ row, parsed: { question: raw.question.trim(), goldPoints, goldDocIds, tags } });
  });
  return { valid, errors };
}
