import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { PromptNode } from "@codecrush/contracts";
import { withSpan } from "@codecrush/otel";
import { CODECRUSH_SPAN_KIND, GEN_AI, OTEL_OPERATIONS, RAG } from "@codecrush/otel-conventions";
import { ModelsService } from "../../models/models.service";
import type { ChatMessage, StructuredOutputSpec } from "../../models/ports/model-provider.port";
import { NodeContractRegistry } from "../contracts/registry";
import type { NodeContract, ValidationIssue } from "../contracts/types";
import { assembleMessages } from "../compiler/assemble";
import { normalizeStructuredOutput } from "./normalize";
import type { RuntimeContext } from "../compiler/runtime-context";

export interface ValidateStep {
  step: "input" | "output_schema" | "extra_validate" | "repair" | "fallback";
  ok: boolean;
  issues?: string[];
}

export interface ExecuteStructuredResult<TOutput> {
  output: TOutput;
  fallbackUsed: boolean;
  validateSteps: ValidateStep[];
}

export interface StreamTextResult {
  text: string;
  fallbackUsed: boolean;
}

export interface NodeExecuteOptions {
  /** TryRunPromptRequest.temperature / NodeSampleRequest.modelParams.temperature 透传 */
  temperature?: number;
}

export interface NodeSampleRequest {
  node: PromptNode;
  contractVersion: number;
  promptVersionId: string;
  promptBody: string;
  modelId: string;
  // topP 当前无协议层落点（011/009 均未定义注入方式），接收但不使用——
  // 见 spec.md Risks #8，不在本任务内擅自发明映射规则。
  modelParams: { temperature: number; topP: number };
  samples: Array<{ input: unknown; runtimeContext: RuntimeContext }>;
}

export interface NodeSampleResult {
  ok: boolean;
  results: Array<{
    sampleIndex: number;
    ok: boolean;
    fallbackUsed: boolean;
    issues: ValidationIssue[];
    traceId?: string;
  }>;
}

// 011 Design §2 协议适配矩阵：本任务只支持三个 llm 协议的首选机制，不做能力探测/降级
export const SUPPORTED_CHAT_PROTOCOLS = ["openai_compat", "anthropic", "gemini"] as const;

/** 协议不在 SUPPORTED_CHAT_PROTOCOLS 内——prompts.service 捕获后转 unavailable/unsupported_protocol */
export class UnsupportedChatProtocolError extends Error {}

@Injectable()
export class NodeRuntimeService {
  constructor(private readonly models: ModelsService) {}

  /** 查模型行 + 协议合法性检查（两处调用方共用，一次查询同时服务两个目的：拒绝非法协议 + 拿 GEN_AI span 属性） */
  private async resolveModel(modelId: string) {
    const model = await this.models.get(modelId);
    if (!(SUPPORTED_CHAT_PROTOCOLS as readonly string[]).includes(model.protocol)) {
      throw new UnsupportedChatProtocolError(
        `protocol ${model.protocol} 不支持 NodeRuntime 结构化/流式调用`,
      );
    }
    return model;
  }

  async executeStructured<TInput extends Record<string, unknown>, TOutput, TReserved>(
    node: PromptNode,
    contractVersion: number,
    promptBody: string,
    modelId: string,
    input: TInput,
    reserved: TReserved,
    opts?: NodeExecuteOptions,
  ): Promise<ExecuteStructuredResult<TOutput>> {
    const contract = NodeContractRegistry.resolve(node, contractVersion) as unknown as NodeContract<
      TInput,
      TOutput,
      TReserved
    >;
    const steps: ValidateStep[] = [];

    const inputCheck = contract.inputSchema.safeParse(input);
    steps.push({ step: "input", ok: inputCheck.success });
    if (!inputCheck.success) {
      return {
        output: contract.fallback(input, reserved),
        fallbackUsed: true,
        validateSteps: [...steps, { step: "fallback", ok: true }],
      };
    }

    const model = await this.resolveModel(modelId);

    return withSpan(
      "node_runtime.execute_structured",
      {
        attributes: {
          [RAG.NODE_NAME]: node,
          [RAG.PROMPT_CONTRACT_VERSION]: contractVersion,
          [GEN_AI.OPERATION_NAME]: OTEL_OPERATIONS.CHAT,
          [GEN_AI.SYSTEM]: model.protocol,
          [GEN_AI.REQUEST_MODEL]: model.deploymentId ?? model.name,
          [RAG.STRUCTURED_OUTPUT_MODE]: "json_schema",
          "codecrush.span.kind": CODECRUSH_SPAN_KIND.LLM,
        },
      },
      async (span) => {
        const structuredOutput: StructuredOutputSpec = {
          name: `${contract.key}_v${contract.version}`,
          schema: z.toJSONSchema(contract.outputSchema as z.ZodType) as Record<string, unknown>,
          strict: true,
        };
        const chatOpts = { structuredOutput, temperature: opts?.temperature };

        const attempt = async (
          messages: ChatMessage[],
        ): Promise<{ ok: true; output: TOutput } | { ok: false; issues: string[] }> => {
          const res = await this.models.chat(modelId, messages, chatOpts);
          const normalized = normalizeStructuredOutput(res.content);
          let parsed: unknown;
          try {
            parsed = JSON.parse(normalized);
          } catch {
            return { ok: false, issues: ["模型输出不是合法 JSON"] };
          }
          const outCheck = contract.outputSchema.safeParse(parsed);
          if (!outCheck.success) {
            return { ok: false, issues: outCheck.error.issues.map((i) => i.message) };
          }
          const extra = contract.extraValidate?.(outCheck.data, reserved) ?? [];
          if (extra.length > 0) {
            return { ok: false, issues: extra.map((i) => i.message) };
          }
          return { ok: true, output: outCheck.data };
        };

        const messages = assembleMessages({ contract, promptBody, input, reserved });
        const first = await attempt(messages);
        steps.push({ step: "output_schema", ok: first.ok, issues: first.ok ? undefined : first.issues });
        if (first.ok) {
          span.setAttribute(RAG.FALLBACK_USED, false);
          span.setAttribute(RAG.REPAIR_RETRY_COUNT, 0);
          return { output: first.output, fallbackUsed: false, validateSteps: steps };
        }
        span.setAttribute(RAG.VALIDATION_ERROR_CODE, first.issues[0] ?? "unknown");

        const repairMessages: ChatMessage[] = [
          ...messages,
          {
            role: "user",
            content: `上一次输出未通过校验：${first.issues.join("; ")}。请重新输出，严格符合 JSON Schema，不要输出除 JSON 以外的任何内容。`,
          },
        ];
        const second = await attempt(repairMessages);
        steps.push({ step: "repair", ok: second.ok, issues: second.ok ? undefined : second.issues });
        span.setAttribute(RAG.REPAIR_RETRY_COUNT, 1);
        if (second.ok) {
          span.setAttribute(RAG.FALLBACK_USED, false);
          return { output: second.output, fallbackUsed: false, validateSteps: steps };
        }

        steps.push({ step: "fallback", ok: true });
        span.setAttribute(RAG.FALLBACK_USED, true);
        return { output: contract.fallback(input, reserved), fallbackUsed: true, validateSteps: steps };
      },
    );
  }

  async streamText<TInput extends Record<string, unknown>, TOutput extends { text: string }, TReserved>(
    node: PromptNode,
    contractVersion: number,
    promptBody: string,
    modelId: string,
    input: TInput,
    reserved: TReserved,
    opts?: NodeExecuteOptions,
  ): Promise<StreamTextResult> {
    const contract = NodeContractRegistry.resolve(node, contractVersion) as unknown as NodeContract<
      TInput,
      TOutput,
      TReserved
    >;
    // fallback 节点自己的 fallback 路径永不调用模型（011 Design §1）——不查模型行，不受 opts 影响
    if (contract.node === "fallback") {
      return { text: contract.fallback(input, reserved).text, fallbackUsed: true };
    }

    const model = await this.resolveModel(modelId);

    return withSpan(
      "node_runtime.stream_text",
      {
        attributes: {
          [RAG.NODE_NAME]: node,
          [RAG.PROMPT_CONTRACT_VERSION]: contractVersion,
          [GEN_AI.OPERATION_NAME]: OTEL_OPERATIONS.CHAT,
          [GEN_AI.SYSTEM]: model.protocol,
          [GEN_AI.REQUEST_MODEL]: model.deploymentId ?? model.name,
          "codecrush.span.kind": CODECRUSH_SPAN_KIND.LLM,
        },
      },
      async (span) => {
        const messages = assembleMessages({ contract, promptBody, input, reserved });
        let text = "";
        try {
          const stream = await this.models.chatStream(modelId, messages, { temperature: opts?.temperature });
          for await (const chunk of stream) {
            if (chunk.error) {
              throw new Error(chunk.error);
            }
            if (chunk.delta) text += chunk.delta;
            if (chunk.done) break;
          }
        } catch {
          text = "";
        }
        if (text.length === 0) {
          span.setAttribute(RAG.FALLBACK_USED, true);
          return { text: contract.fallback(input, reserved).text, fallbackUsed: true };
        }
        span.setAttribute(RAG.FALLBACK_USED, false);
        return { text, fallbackUsed: false };
      },
    );
  }

  async compileAndSample(request: NodeSampleRequest): Promise<NodeSampleResult> {
    const opts: NodeExecuteOptions = { temperature: request.modelParams.temperature };
    const results: NodeSampleResult["results"] = [];
    for (let i = 0; i < request.samples.length; i++) {
      const sample = request.samples[i];
      if (request.node === "reply" || request.node === "fallback") {
        const r = await this.streamText(
          request.node,
          request.contractVersion,
          request.promptBody,
          request.modelId,
          sample.input as Record<string, unknown>,
          sample.runtimeContext,
          opts,
        );
        results.push({ sampleIndex: i, ok: !r.fallbackUsed, fallbackUsed: r.fallbackUsed, issues: [] });
      } else {
        const r = await this.executeStructured(
          request.node,
          request.contractVersion,
          request.promptBody,
          request.modelId,
          sample.input as Record<string, unknown>,
          sample.runtimeContext,
          opts,
        );
        const issues = r.validateSteps.flatMap((s) =>
          (s.issues ?? []).map((message) => ({ code: s.step.toUpperCase(), message })),
        );
        results.push({ sampleIndex: i, ok: !r.fallbackUsed, fallbackUsed: r.fallbackUsed, issues });
      }
    }
    return { ok: results.every((r) => r.ok), results };
  }
}
