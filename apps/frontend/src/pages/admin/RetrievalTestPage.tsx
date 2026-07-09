import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Empty, Input, InputNumber, Select, Slider, Switch, Tag } from "antd";
import type { Agent, KnowledgeBase, ModelProvider, RetrievalHit } from "@codecrush/contracts";
import { getAgents, getKnowledgeBases, getModels, testRetrieval } from "../../api/client";
import type { RetrievalTestApplyState } from "./AgentsPage";

const { TextArea } = Input;

/** 知识检索测试：左配置 + 右结果。M5 接真实 POST /api/retrieval/test，antd 组件化。
 * 「从 Agent 加载」/「带入新建配置版本」与 Agent 管理（M7）联动，形成测试 → 发布闭环。 */

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function RetrievalTestPage() {
  const navigate = useNavigate();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [models, setModels] = useState<ModelProvider[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadErr, setLoadErr] = useState("");
  // 「从 Agent 加载」选中的 Agent，"" = 手动配置；仅作为参数起点，不反向绑定表单
  const [agentId, setAgentId] = useState("");

  const [kbId, setKbId] = useState<string>();
  const [embedModelId, setEmbedModelId] = useState<string>();
  const [threshold, setThreshold] = useState(0.65);
  const [vecWeight, setVecWeight] = useState(0.6);
  const [rerankModelId, setRerankModelId] = useState<string>();
  const [rerankThreshold, setRerankThreshold] = useState(0.5);
  const [multi, setMulti] = useState(true);
  const [topK, setTopK] = useState(20);
  const [topN, setTopN] = useState(10);
  const [query, setQuery] = useState("");

  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [runErr, setRunErr] = useState("");
  const [hits, setHits] = useState<RetrievalHit[]>([]);
  // 本次已展示结果实际使用的阈值快照——跑完后再拖滑杆，头部标签不能跟着实时值撒谎
  const [ranThreshold, setRanThreshold] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [kbList, modelList, agentList] = await Promise.all([
          getKnowledgeBases(),
          getModels(),
          getAgents(),
        ]);
        setKbs(kbList);
        setModels(modelList);
        setAgents(agentList);
        if (kbList[0]) setKbId(kbList[0].id);
        const firstEmbed = modelList.find((m) => m.type === "embedding" && m.enabled);
        if (firstEmbed) setEmbedModelId(firstEmbed.id);
      } catch (e) {
        setLoadErr(errMsg(e));
      }
    })();
  }, []);

  const embedOpts = models.filter((m) => m.type === "embedding" && m.enabled);
  const rerankOpts = models.filter((m) => m.type === "rerank" && m.enabled);
  // 只有存在生产版本的 Agent 才有配置可带入
  const agentOpts = agents.filter((a) => a.currentVersion !== null);
  const loadedAgent = agentOpts.find((a) => a.id === agentId);

  /** 「从 Agent 加载」：把生产配置带入表单作为起点（Embedding 由绑定知识库决定） */
  const loadFromAgent = (id: string) => {
    setAgentId(id);
    const v = agents.find((a) => a.id === id)?.currentVersion;
    if (!v) return;
    const kb = kbs.find((k) => k.id === v.kbIds[0]);
    if (kb) {
      setKbId(kb.id);
      setEmbedModelId(kb.embeddingModelId);
    }
    setThreshold(v.threshold);
    setMulti(v.multiRecall);
    if (v.vecWeight !== undefined) setVecWeight(v.vecWeight);
    setRerankModelId(v.rerankModelId);
    setTopK(v.topK);
    setTopN(v.topN);
  };

  /** 「带入新建配置版本」：当前测试参数经路由 state 推给 Agent 管理页的新建配置版本抽屉 */
  const applyToAgent = () => {
    if (!loadedAgent) return;
    const retrievalTestApply: RetrievalTestApplyState = {
      agentId: loadedAgent.id,
      params: {
        topK,
        topN,
        threshold,
        multiRecall: multi,
        vecWeight: multi ? vecWeight : undefined,
        rerankModelId,
      },
      note: `来源：检索测试：${query.trim()}`,
    };
    navigate("/admin/agents", { state: { retrievalTestApply } });
  };

  const run = async () => {
    if (!query.trim() || !kbId || !embedModelId) return;
    setRunning(true);
    setRunErr("");
    try {
      const res = await testRetrieval({
        query: query.trim(),
        kbId,
        embedModelId,
        topK,
        threshold,
        multi,
        vecWeight,
        rerankModelId,
        rerankThreshold: rerankModelId ? rerankThreshold : undefined,
        topN,
      });
      setHits(res.hits);
      setRanThreshold(threshold);
      setRan(true);
    } catch (e) {
      setRunErr(errMsg(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>知识检索测试</div>
      <div style={{ fontSize: 13, color: "rgba(0,0,0,.45)", marginBottom: 16, lineHeight: 1.7 }}>
        验证召回配置：确认当前设置能从知识库召回正确的文本块。此处的调整仅用于测试，不会自动保存到
        Agent 配置。
      </div>
      {loadErr && <Alert type="error" message={loadErr} style={{ marginBottom: 16 }} />}

      <div
        style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 16, alignItems: "start" }}
      >
        <Card title="测试设置" size="small">
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Field
              label={
                <>
                  从 Agent 加载{" "}
                  <span style={{ color: "rgba(0,0,0,.4)" }}>带入其生产配置作为起点，可选</span>
                </>
              }
            >
              <Select
                value={agentId}
                onChange={loadFromAgent}
                options={[
                  { value: "", label: "不选择（手动配置）" },
                  ...agentOpts.map((a) => ({ value: a.id, label: a.name })),
                ]}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="检索知识库">
              <Select
                value={kbId}
                onChange={setKbId}
                options={kbs.map((k) => ({ value: k.id, label: k.name }))}
                placeholder="选择知识库"
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="向量模型（Embedding）">
              <Select
                value={embedModelId}
                onChange={setEmbedModelId}
                options={embedOpts.map((m) => ({ value: m.id, label: m.name }))}
                placeholder="选择 Embedding 模型"
                style={{ width: "100%" }}
              />
            </Field>
            <Field label={`相似度阈值 · ${threshold.toFixed(2)}`}>
              <Slider min={0} max={1} step={0.01} value={threshold} onChange={setThreshold} />
            </Field>
            <Field
              label={`向量 / 关键词权重 · 向量 ${vecWeight.toFixed(2)} · 关键词 ${(1 - vecWeight).toFixed(2)}`}
            >
              <Slider min={0} max={1} step={0.05} value={vecWeight} onChange={setVecWeight} />
            </Field>
            <Field label="Rerank 模型">
              <Select
                value={rerankModelId}
                onChange={setRerankModelId}
                allowClear
                placeholder="不启用重排"
                options={rerankOpts.map((m) => ({ value: m.id, label: m.name }))}
                style={{ width: "100%" }}
              />
            </Field>
            {rerankModelId && (
              <Field label={`Rerank 分数阈值 · ${rerankThreshold.toFixed(2)}`}>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={rerankThreshold}
                  onChange={setRerankThreshold}
                />
              </Field>
            )}
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <div>
                <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>
                  多路召回（向量 + 关键词）
                </div>
                <div style={{ fontSize: 12, color: "rgba(0,0,0,.4)" }}>关闭则仅向量召回</div>
              </div>
              <Switch checked={multi} onChange={setMulti} />
            </div>
            <Field label="召回 Top-K">
              <InputNumber
                min={1}
                max={200}
                value={topK}
                onChange={(v) => setTopK(v ?? 20)}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="前 N 条">
              <Select
                value={topN}
                onChange={setTopN}
                // Agent 生产配置的 topN 可能不在预设档位里，补进选项避免显示裸数字
                options={[...new Set([5, 10, 20, 50, topN])]
                  .sort((a, b) => a - b)
                  .map((n) => ({ value: n, label: `前 ${n} 条` }))}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="测试问题">
              <TextArea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="输入一个问题，测试能召回哪些文本块…"
                rows={4}
              />
            </Field>
            <Button
              type="primary"
              onClick={run}
              loading={running}
              disabled={!query.trim() || !kbId || !embedModelId}
              style={{ alignSelf: "flex-end" }}
            >
              运行 ➤
            </Button>
          </div>
        </Card>

        <Card
          title={
            <span>
              测试结果
              {ran && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    color: "rgba(0,0,0,.45)",
                    marginLeft: 10,
                  }}
                >
                  共 {hits.length} 条 · 阈值 {ranThreshold.toFixed(2)} 以上
                </span>
              )}
            </span>
          }
          size="small"
          // 结果框 sticky 钉在视口内，高度 = 视口 - 56 顶栏 - 上下 20 留白；sticky 偏移相对
          // Content 的 padding 边缘计算，top 0 即吸附在顶栏下 20px 处。命中列表在框体内滚，
          // 头部（数量/阈值）与底部操作栏恒定可见
          style={{
            position: "sticky",
            top: 0,
            height: "calc(100vh - 96px)",
            display: "flex",
            flexDirection: "column",
          }}
          styles={{ body: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } }}
        >
          {runErr && (
            <Alert type="error" message={runErr} style={{ marginBottom: 12, flex: "none" }} />
          )}
          {ran ? (
            hits.length === 0 ? (
              <CenterBox>
                <Empty description="没有召回结果，尝试降低相似度阈值" />
              </CenterBox>
            ) : (
              <>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {hits.map((r, i) => (
                  <div
                    key={r.chunkId}
                    // flex none：父级是 overflow 滚动的 flex column，不加会被压扁而不是触发滚动
                    style={{
                      flex: "none",
                      border: "1px solid #f0f0f0",
                      borderRadius: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        padding: "9px 14px",
                        background: "#fafafa",
                        borderBottom: "1px solid #f0f0f0",
                      }}
                    >
                      <Tag color="blue">#{i + 1}</Tag>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#1677ff" }}>
                        {(r.finalScore * 100).toFixed(2)}{" "}
                        <span style={{ fontWeight: 400, color: "rgba(0,0,0,.4)" }}>最终</span>
                      </span>
                      <span style={{ fontSize: 12, color: "rgba(0,0,0,.5)" }}>
                        {(r.vecScore * 100).toFixed(2)} 向量
                      </span>
                      {r.kwScore !== undefined && (
                        <span style={{ fontSize: 12, color: "rgba(0,0,0,.5)" }}>
                          {(r.kwScore * 100).toFixed(2)} 关键词
                        </span>
                      )}
                      {r.rerankScore !== undefined && <Tag color="purple">已重排</Tag>}
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, color: "rgba(0,0,0,.4)" }}>{r.docName}</span>
                    </div>
                    <div
                      style={{
                        padding: "12px 14px",
                        fontSize: 13,
                        lineHeight: 1.85,
                        whiteSpace: "pre-wrap",
                        color: "rgba(0,0,0,.82)",
                      }}
                    >
                      {r.text}
                    </div>
                  </div>
                ))}
              </div>
              {/* 测试 → 发布闭环：选了 Agent 且有召回结果时，可把这套参数带回其新建配置版本；
                  flex none + borderTop 钉在框体底部，不随列表滚动 */}
              {loadedAgent && (
                <div
                  style={{
                    flex: "none",
                    borderTop: "1px solid #f0f0f0",
                    marginTop: 14,
                    paddingTop: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 12, color: "rgba(0,0,0,.4)" }}>
                    对结果满意？可把这套参数带入生产配置
                  </span>
                  <Button onClick={applyToAgent}>
                    ↳ 带入「{loadedAgent.name}」新建配置版本
                  </Button>
                </div>
              )}
              </>
            )
          ) : (
            <CenterBox>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="输入问题并点击「运行」查看召回结果"
              />
            </CenterBox>
          )}
        </Card>
      </div>
    </div>
  );
}

/** 固定高度结果框内的空态垂直居中容器 */
function CenterBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>{label}</div>
      {children}
    </div>
  );
}
