import { z } from "zod";

const isoString = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

/** 原型 §18.B：用例只有两态；`reviewed` 编辑保存后仍是 `reviewed`（v+1），不回退 draft。 */
export const EvalCaseStatusSchema = z.enum(["draft", "reviewed"]);
export type EvalCaseStatus = z.infer<typeof EvalCaseStatusSchema>;

/** §19.1：名称 1-50 字，全局唯一（唯一性在 service 层查重，返回「名称已存在」）。 */
export const CreateEvalSetRequestSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  kbIds: z.array(uuid).default([]),
});
export type CreateEvalSetRequest = z.infer<typeof CreateEvalSetRequestSchema>;

export const UpdateEvalSetRequestSchema = CreateEvalSetRequestSchema.partial();
export type UpdateEvalSetRequest = z.infer<typeof UpdateEvalSetRequestSchema>;

export const EvalSetSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(50),
  description: z.string(),
  kbIds: z.array(uuid),
  caseCount: z.number().int().nonnegative(),
  reviewedCaseCount: z.number().int().nonnegative(),
  /** gold docs 覆盖率（原型 §5「38/50」）——分母为已审用例数。W2a 只展示不消费（决策 E）。 */
  goldDocCoverage: z.object({
    withGoldDocs: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  lastRunScore: z.number().min(0).max(100).nullable(),
  createdAt: isoString,
  updatedAt: isoString,
});
export type EvalSet = z.infer<typeof EvalSetSchema>;

export const EvalSetListResponseSchema = z.array(EvalSetSchema);
export type EvalSetListResponse = z.infer<typeof EvalSetListResponseSchema>;

/**
 * §19.1：问题 1-500；gold 要点每条 ≤200（draft 可空，reviewed 要求 ≥1 —— service 层校验，
 * 因两态阈值不同，DB check 表达不了）；gold 文档 ≤10；标签 ≤5 个、每个 ≤12 字。
 */
export const CreateEvalCaseRequestSchema = z.object({
  question: z.string().min(1).max(500),
  goldPoints: z.array(z.string().min(1).max(200)).default([]),
  goldDocIds: z.array(uuid).max(10).default([]),
  tags: z.array(z.string().min(1).max(12)).max(5).default([]),
  sourceTraceId: z
    .string()
    .regex(/^[a-f0-9]{32}$/i)
    .optional(),
});
export type CreateEvalCaseRequest = z.infer<typeof CreateEvalCaseRequestSchema>;

/** 内容字段改动 → 新建不可变版本；status 单独走（审核通过）。 */
export const UpdateEvalCaseRequestSchema = z.object({
  question: z.string().min(1).max(500).optional(),
  goldPoints: z.array(z.string().min(1).max(200)).optional(),
  goldDocIds: z.array(uuid).max(10).optional(),
  tags: z.array(z.string().min(1).max(12)).max(5).optional(),
  status: EvalCaseStatusSchema.optional(),
});
export type UpdateEvalCaseRequest = z.infer<typeof UpdateEvalCaseRequestSchema>;

export const EvalCaseSchema = z.object({
  id: uuid,
  setId: uuid,
  version: z.number().int().positive(),
  status: EvalCaseStatusSchema,
  question: z.string(),
  goldPoints: z.array(z.string()),
  goldDocIds: z.array(uuid),
  tags: z.array(z.string()),
  sourceTraceId: z.string().nullable(),
  /** 原型 §18.B。W2a 建列不建检测器 → 恒 false，UI 不显示橙 tag（018 已知缺口 4）。 */
  goldStale: z.boolean(),
  createdAt: isoString,
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalCaseListResponseSchema = z.array(EvalCaseSchema);
export type EvalCaseListResponse = z.infer<typeof EvalCaseListResponseSchema>;

/**
 * CSV 在前端解析（决策 D13：后端无文件上传基建，且 contracts 只依赖 zod → multipart 无法用
 * Zod DTO 表达）。§19.1：≤1000 行，必列 question/gold_answer。
 */
export const ImportEvalCasesRequestSchema = z.object({
  rows: z
    .array(
      z.object({
        question: z.string().min(1).max(500),
        goldAnswer: z.string().min(1),
        goldDocs: z.string().optional(),
        tags: z.string().optional(),
      }),
    )
    .min(1)
    .max(1000),
});
export type ImportEvalCasesRequest = z.infer<typeof ImportEvalCasesRequestSchema>;

export const ImportEvalCasesResponseSchema = z.object({
  imported: z.number().int().nonnegative(),
  errors: z.array(z.object({ row: z.number().int().positive(), message: z.string() })),
});
export type ImportEvalCasesResponse = z.infer<typeof ImportEvalCasesResponseSchema>;
