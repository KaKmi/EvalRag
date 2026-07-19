import { z } from "zod";
import type { StructuredOutputSpec } from "../models/ports/model-provider.port";
import { EVALUATION_EVIDENCE_MAX_LENGTH } from "./evaluation.constants";

// 2026-07-17 起从 2 提到 3：诊断实测 provider 偶发空响应（"chat 响应形状不符：未找到
// 非空文本输出"，DeepSeek 官方文档承认的已知抖动），2 次预算里若两次都撞上纯属倒霉，
// 一次真正的 schema 修复重试都没轮到就已经报废。多给一次，用来吸收这类瞬时噪音，
// 不是为了给 schema 归一化兜底——那部分已经在 0 次结构性失败中验证过了。
const MAX_ATTEMPTS = 3;

/**
 * `rawOutput` 携带模型上一次的（坏）输出——仅当失败发生在**已经拿到响应之后**
 * （JSON/schema 校验失败）才有值；provider 调用本身失败（超时/空响应）没有
 * 输出可言，`rawOutput` 留空，`withJudgeRetry` 退回原样重试。
 */
export class RetriableJudgeError extends Error {
  constructor(
    message: string,
    public readonly rawOutput?: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "RetriableJudgeError";
  }
}

/**
 * 2026-07-17 起不再发 `strict: true`。实测证据：DeepSeek 官方文档对 JSON 输出
 * 唯一承诺的是"合法 JSON 字符串"（不保证字段完整/类型正确），且其 issue tracker
 * 有一条已确认、维护者标记不修的 bug——开启 `strict: true` 后返回的 JSON **反而
 * 语法本身损坏**（首个属性名缺闭合引号）。我们自己的诊断（12 次真实调用）也观测到
 * 同款 `Unterminated string`/缺引号症状。`strict` 在这条 provider 上没有实证收益，
 * 只有实证的坏处，故直接不发——app 侧的 Zod 校验 + 下面的修复重试才是真正的把关。
 */
export function structuredOutput(name: string, schema: z.ZodType): StructuredOutputSpec {
  return {
    name,
    schema: z.toJSONSchema(schema) as Record<string, unknown>,
  };
}

export function parseJudgeOutput<T>(content: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RetriableJudgeError(`judge output is not valid JSON: ${message}`, content, error);
  }
  const result = schema.safeParse(parsed);
  if (result.success) return result.data;
  // 具体报哪条规则违反了，而不只是"校验失败"——这条详情会被喂回给模型做修复，
  // 含糊的错误信息只会让模型第二次还是瞎猜。
  const detail = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new RetriableJudgeError(
    `judge output failed schema validation: ${detail}`,
    content,
    result.error,
  );
}

export async function callJudgeProvider<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    // provider 调用本身失败（超时/HTTP 错误/空响应）——没有输出可言，rawOutput 留空。
    throw new RetriableJudgeError(
      "judge provider call failed",
      undefined,
      error,
    );
  }
}

export function invalidJudgeOutput(message: string): never {
  throw new RetriableJudgeError(message);
}

/** 上一次失败的详情——喂给下一次调用，让模型看到具体错在哪、而不是被要求重新蒙一次。 */
export interface PriorJudgeFailure {
  rawOutput: string;
  errorMessage: string;
}

/**
 * 把上一次失败的原始输出 + 具体报错拼成一条修复指令，追加为新的 user 轮次。
 * 不用 assistant 角色回放（`ChatMessage.role` 只有 system|user，扩它要动全部
 * adapter，代价过高）——把"你上次说了什么、错在哪"直接写进文本里，语义等价，
 * provider 视角看仍是单轮追加的 user 消息。
 */
export function repairInstruction(priorFailure: PriorJudgeFailure): string {
  return [
    "Your previous response failed validation.",
    "Your previous output was:",
    priorFailure.rawOutput,
    `Validation error: ${priorFailure.errorMessage}`,
    "Return a corrected JSON that fixes this specific issue. Return JSON only, no other text, no markdown code fences.",
  ].join("\n");
}

/**
 * `attempt` 现在接收上一次失败的详情（`undefined` = 第一次调用）。校验失败时
 * （`rawOutput` 有值）下一次调用会拿到它，evaluator 据此在 messages 里追加
 * 修复指令；provider 级失败（`rawOutput` 为空）则原样重试——那类失败没有"上次
 * 输出"可供修复，且往往是真随机的瞬时故障，重试本身就是对的策略。
 *
 * 这是本次改动的核心：曾经的重试是原样重发同一个 prompt，对"模型这次就是不写
 * reason 字段"这类系统性倾向毫无意义（同输入两次抽到同一个错）；带着错误详情
 * 重问，等价于业内的 repair/fix parser 模式（LangChain OutputFixingParser 等）。
 */
export async function withJudgeRetry<T>(
  // "correctness" 是 E-W2a 的加性扩宽（018 决策 D）；"citation" 是 E-W2b F4 的加性扩宽——
  // 既有值一字未动。
  metric: "faithfulness" | "answer relevancy" | "context precision" | "correctness" | "citation",
  attempt: (priorFailure?: PriorJudgeFailure) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  let priorFailure: PriorJudgeFailure | undefined;
  for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
    try {
      return await attempt(priorFailure);
    } catch (error) {
      if (!(error instanceof RetriableJudgeError)) throw error;
      lastError = error;
      priorFailure =
        error.rawOutput !== undefined
          ? { rawOutput: error.rawOutput, errorMessage: error.message }
          : undefined;
    }
  }
  const detail = describeJudgeFailure(lastError);
  throw new Error(
    detail
      ? `${metric} judge output invalid after retry（${detail}）`
      : `${metric} judge output invalid after retry`,
    { cause: lastError },
  );
}

/**
 * 把**末次失败的原因**折进最终错误消息。
 *
 * 为什么必须折进 message 而不是留在 `cause`：三个落点——`eval_manual_score_jobs.last_error`、
 * `rag.eval` span 的 `error.message`、前端质量面板——**都只读 message**，`cause` 在每一层
 * 都被丢掉。2026-07-19 一次真实故障因此在三处都只显示 `faithfulness judge output invalid
 * after retry`，无法从任何产物定位，只能另写探针逐层复现，才发现根因是模型配的
 * `max_tokens=2048` 把判分输出（实测带 json_schema 时达 5731 字符）截断。
 * 那次排查花掉的时间，本该是「看一眼错误信息」。
 *
 * 只带**原因与长度**，不带 `rawOutput` 正文：正文含用户答案与检索内容，会随 span 进
 * ClickHouse，属不该外扩的内容面。长度足以区分「被截断」与「格式跑偏」两类，够定位了。
 */
function describeJudgeFailure(error: unknown): string {
  if (!(error instanceof RetriableJudgeError)) return "";
  const parts = [error.message];
  if (error.rawOutput !== undefined) {
    parts.push(`返回长度 ${error.rawOutput.length} 字符`);
    // JSON 都解析不了 + 确实收到了输出 ⇒ 极可能是被 max_tokens 截断，而非模型格式跑偏：
    // 格式跑偏通常仍是一段**完整**的 JSON，只是字段不对（那会走 schema 校验失败分支）。
    if (error.message.includes("not valid JSON")) {
      parts.push("疑似被 max_tokens 截断——请检查该判分模型的 max_tokens 是否够容纳判分输出");
    }
  }
  return parts.join("；");
}

export function limitedEvidence(values: string[], emptyMessage: string): string[] {
  const limited = values.slice(0, 3).map((value) => value.slice(0, EVALUATION_EVIDENCE_MAX_LENGTH));
  return limited.length === 0 ? [emptyMessage] : limited;
}
