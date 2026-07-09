import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Input, InputNumber, Select, Slider, Switch, Tag } from "antd";
import type { KnowledgeBase, ModelProvider, RetrievalHit } from "@codecrush/contracts";
import { getKnowledgeBases, getModels, testRetrieval } from "../../api/client";

const { TextArea } = Input;

/** 知识检索测试：左配置 + 右结果。M5 接真实 POST /api/retrieval/test，antd 组件化。 */

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function RetrievalTestPage() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [models, setModels] = useState<ModelProvider[]>([]);
  const [loadErr, setLoadErr] = useState("");

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

  useEffect(() => {
    (async () => {
      try {
        const [kbList, modelList] = await Promise.all([getKnowledgeBases(), getModels()]);
        setKbs(kbList);
        setModels(modelList);
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
                options={[5, 10, 20, 50].map((n) => ({ value: n, label: `前 ${n} 条` }))}
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
                  共 {hits.length} 条 · 阈值 {threshold.toFixed(2)} 以上
                </span>
              )}
            </span>
          }
          size="small"
        >
          {runErr && <Alert type="error" message={runErr} style={{ marginBottom: 12 }} />}
          {ran ? (
            hits.length === 0 ? (
              <Empty description="没有召回结果，尝试降低相似度阈值" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {hits.map((r, i) => (
                  <div
                    key={r.chunkId}
                    style={{ border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden" }}
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
            )
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="输入问题并点击「运行」查看召回结果"
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>{label}</div>
      {children}
    </div>
  );
}
