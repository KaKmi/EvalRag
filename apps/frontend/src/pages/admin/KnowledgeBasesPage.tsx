import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { ChunkTemplate, KnowledgeBase, ModelProvider } from "@codecrush/contracts";
import { createKnowledgeBase, getKnowledgeBases, getModels } from "../../api/client";
import { tagOf, type TagKey } from "../../mocks/agents";

/** 知识库管理：卡片网格（对齐原型）。点击卡片 / 「进入」跳文档页。M4 接真实 /api/knowledge-bases。 */

const btnPrimary: CSSProperties = {
  height: 32,
  padding: "0 16px",
  background: "#1677ff",
  color: "#fff",
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  cursor: "pointer",
  userSelect: "none",
};

const btnGhost: CSSProperties = {
  height: 36,
  padding: "0 18px",
  border: "1px solid #d9d9d9",
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  fontSize: 14,
  cursor: "pointer",
  userSelect: "none",
};

const linkBlue: CSSProperties = { color: "#1677ff", cursor: "pointer" };

const kbCard: CSSProperties = {
  background: "#fff",
  border: "1px solid #f0f0f0",
  borderRadius: 10,
  padding: "18px 20px",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.45)",
  zIndex: 60,
};

const modalCard: CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%,-50%)",
  width: 480,
  background: "#fff",
  zIndex: 61,
  borderRadius: 12,
  boxShadow: "0 12px 40px rgba(0,0,0,.18)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const modalHeader: CSSProperties = {
  height: 56,
  flex: "none",
  borderBottom: "1px solid #f0f0f0",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 24px",
};

const modalBody: CSSProperties = {
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 18,
  maxHeight: "70vh",
  overflowY: "auto",
};

const modalFooter: CSSProperties = {
  flex: "none",
  borderTop: "1px solid #f0f0f0",
  padding: "14px 24px",
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
};

const fieldLabel: CSSProperties = { fontSize: 13, color: "rgba(0,0,0,.65)" };

const inputStyle: CSSProperties = {
  height: 36,
  padding: "0 12px",
  border: "1px solid #d9d9d9",
  borderRadius: 6,
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  height: 64,
  padding: "8px 12px",
  resize: "none",
  fontFamily: "inherit",
};

const errBar: CSSProperties = {
  marginBottom: 12,
  padding: "8px 12px",
  border: "1px solid #ffccc7",
  background: "#fff2f0",
  borderRadius: 6,
  fontSize: 13,
  color: "#cf1322",
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const CHUNK_OPTS: { value: ChunkTemplate; label: string; desc: string }[] = [
  { value: "general", label: "通用", desc: "按标题结构切分，适合 Markdown / TXT / 层级清晰的文档" },
  { value: "qa", label: "问答", desc: "识别问答对，一问一答作为一个切片，适合 FAQ 文档" },
];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 状态标签：ready/failed 直接映射；building 需拼上后端返回的 progress 字段（不假设服务端已拼好文案）。 */
function statusView(r: KnowledgeBase): { label: string; tag: TagKey } {
  if (r.status === "building") return { label: `重建中 ${r.progress ?? 0}%`, tag: "blue" };
  if (r.status === "failed") return { label: "失败", tag: "red" };
  return { label: "已就绪", tag: "green" };
}

interface CreateForm {
  name: string;
  desc: string;
  chunkTemplate: ChunkTemplate;
  embeddingModelId: string;
}

const emptyForm: CreateForm = { name: "", desc: "", chunkTemplate: "general", embeddingModelId: "" };

export default function KnowledgeBasesPage() {
  const [rows, setRows] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const [embeddingModels, setEmbeddingModels] = useState<ModelProvider[]>([]);
  const [embedErr, setEmbedErr] = useState("");
  const [cf, setCf] = useState<CreateForm>(emptyForm);
  const [cfErr, setCfErr] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await getKnowledgeBases());
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 3s 轮询：有 kb 处于 building 态时才轮询，避免空转请求
  useEffect(() => {
    if (!rows.some(r => r.status === "building")) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [rows, load]);

  const openCreate = async () => {
    setCf(emptyForm);
    setCfErr("");
    setEmbedErr("");
    setSaving(false);
    try {
      const models = (await getModels()).filter(m => m.type === "embedding" && m.enabled);
      setEmbeddingModels(models);
      if (models.length === 0) {
        setEmbedErr("暂无可用的 Embedding 模型，请先在「模型接入」页启用一个");
      } else {
        setCf(prev => ({ ...prev, embeddingModelId: models[0].id }));
      }
    } catch (e) {
      setEmbeddingModels([]);
      setEmbedErr(errMsg(e));
    }
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (saving) return;
    setCreateOpen(false);
  };

  const submitCreate = async () => {
    if (!cf.name.trim()) {
      setCfErr("请填写知识库名称");
      return;
    }
    if (!cf.embeddingModelId) {
      setCfErr("请选择 Embedding 模型");
      return;
    }
    setSaving(true);
    setCfErr("");
    try {
      await createKnowledgeBase({
        name: cf.name.trim(),
        desc: cf.desc.trim(),
        chunkTemplate: cf.chunkTemplate,
        embeddingModelId: cf.embeddingModelId,
      });
      setCreateOpen(false);
      await load();
    } catch (e) {
      const msg = errMsg(e);
      setCfErr(msg.includes("409") ? "知识库名称已存在，请更换一个" : msg);
    } finally {
      setSaving(false);
    }
  };

  const goDocs = (id: string) => nav(`/admin/knowledge-bases/${encodeURIComponent(id)}/documents`);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>知识库</div>
        <div onClick={() => void openCreate()} style={btnPrimary}>
          ＋ 新建知识库
        </div>
      </div>
      <div
        style={{
          fontSize: 13,
          color: "rgba(0,0,0,.5)",
          marginBottom: 18,
          lineHeight: 1.7,
          maxWidth: 760,
        }}
      >
        每个知识库是一组文档的集合。上传的文档会被解析、切片、向量化后存入所属知识库，供绑定它的 Agent 检索。
      </div>

      {error && (
        <div style={errBar}>
          <span style={{ flex: 1 }}>{error}</span>
          <span style={{ ...linkBlue, flex: "none" }} onClick={() => void load()}>
            重试
          </span>
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: "rgba(0,0,0,.45)" }}>加载中…</div>}

      {!loading && !error && rows.length === 0 && (
        <div style={{ fontSize: 13, color: "rgba(0,0,0,.45)" }}>
          暂无知识库，点击右上角「＋ 新建知识库」创建。
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 16,
          }}
        >
          {rows.map(r => {
            const sv = statusView(r);
            const t = tagOf(sv.tag);
            return (
              <div key={r.id} style={kbCard} onClick={() => goDocs(r.id)}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      flex: "none",
                      borderRadius: 9,
                      background: "#e6f4ff",
                      color: "#1677ff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <ellipse cx="12" cy="5" rx="9" ry="3" />
                      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                      <path d="M3 12a9 3 0 0 0 18 0" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{r.name}</span>
                      <span
                        style={{
                          fontSize: 11,
                          lineHeight: "18px",
                          padding: "0 7px",
                          borderRadius: 9,
                          background: t.bg,
                          color: t.c,
                          border: `1px solid ${t.bd}`,
                        }}
                      >
                        {sv.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)", marginTop: 3 }}>{r.desc}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 26 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1 }}>{r.docsCount}</div>
                    <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)", marginTop: 4 }}>文档</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1 }}>
                      {r.chunksCount.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)", marginTop: 4 }}>切片</div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <div
                    style={{
                      fontSize: 12,
                      color: "rgba(0,0,0,.4)",
                      textAlign: "right",
                      lineHeight: 1.5,
                    }}
                  >
                    Embedding
                    <br />
                    {r.embeddingModelId}
                  </div>
                </div>
                <div
                  style={{
                    borderTop: "1px solid #f5f5f5",
                    paddingTop: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ fontSize: 12, color: "rgba(0,0,0,.4)" }}>
                    更新于 {r.updatedAt.slice(0, 10)}
                  </span>
                  <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                    <span
                      style={linkBlue}
                      onClick={e => {
                        e.stopPropagation();
                        goDocs(r.id);
                      }}
                    >
                      上传文档
                    </span>
                    <span
                      style={linkBlue}
                      onClick={e => {
                        e.stopPropagation();
                        goDocs(r.id);
                      }}
                    >
                      进入 →
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createOpen && (
        <>
          <div onClick={closeCreate} style={overlay} />
          <div style={modalCard}>
            <div style={modalHeader}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>新建知识库</div>
              <div
                onClick={closeCreate}
                style={{
                  fontSize: 18,
                  color: "rgba(0,0,0,.45)",
                  cursor: "pointer",
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 4,
                }}
              >
                ×
              </div>
            </div>
            <div style={modalBody}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={fieldLabel}>
                  <span style={{ color: "#ff4d4f" }}>* </span>知识库名称
                </div>
                <input
                  value={cf.name}
                  onChange={e => {
                    setCf(prev => ({ ...prev, name: e.target.value }));
                    setCfErr("");
                  }}
                  placeholder="例如：售后服务知识库"
                  style={inputStyle}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={fieldLabel}>描述</div>
                <textarea
                  value={cf.desc}
                  onChange={e => setCf(prev => ({ ...prev, desc: e.target.value }))}
                  placeholder="这个知识库存放什么内容，供哪些 Agent 使用"
                  style={textareaStyle}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={fieldLabel}>分块模板</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {CHUNK_OPTS.map(c => {
                    const on = cf.chunkTemplate === c.value;
                    return (
                      <div
                        key={c.value}
                        onClick={() => setCf(prev => ({ ...prev, chunkTemplate: c.value }))}
                        style={{
                          flex: 1,
                          textAlign: "center",
                          fontSize: 13,
                          lineHeight: "36px",
                          height: 36,
                          borderRadius: 6,
                          border: `1px solid ${on ? "#1677ff" : "#d9d9d9"}`,
                          background: on ? "#e6f4ff" : "#fff",
                          color: on ? "#1677ff" : "rgba(0,0,0,.65)",
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        {c.label}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 12, color: "rgba(0,0,0,.4)", lineHeight: 1.6 }}>
                  {CHUNK_OPTS.find(c => c.value === cf.chunkTemplate)?.desc}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={fieldLabel}>向量模型（Embedding）</div>
                <select
                  value={cf.embeddingModelId}
                  onChange={e => setCf(prev => ({ ...prev, embeddingModelId: e.target.value }))}
                  disabled={embeddingModels.length === 0}
                  style={{ ...inputStyle, background: "#fff" }}
                >
                  {embeddingModels.length === 0 && <option value="">（无可用模型）</option>}
                  {embeddingModels.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 12, color: "rgba(0,0,0,.4)", lineHeight: 1.6 }}>
                  知识库创建后不可更换向量模型，如需切换请新建知识库。
                </div>
                {embedErr && <div style={{ fontSize: 12, color: "#ff4d4f" }}>{embedErr}</div>}
              </div>

              {cfErr && <div style={{ fontSize: 13, color: "#ff4d4f" }}>{cfErr}</div>}
            </div>
            <div style={modalFooter}>
              <div onClick={closeCreate} style={btnGhost}>
                取消
              </div>
              <div
                onClick={() => (saving ? undefined : void submitCreate())}
                style={{ ...btnPrimary, height: 36, padding: "0 18px", opacity: saving ? 0.6 : 1 }}
              >
                {saving ? "创建中…" : "创建"}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
