import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ChunkTemplate,
  Document,
  DocumentLifecycleResponse,
  DocumentLifecycleStage,
  DocumentStatus,
  KnowledgeBase,
} from "@codecrush/contracts";
import {
  deleteDocument,
  getDocumentLifecycle,
  getDocuments,
  getKnowledgeBases,
  triggerParse,
  updateDocumentMetadata,
  updateKnowledgeBase,
  uploadDocuments,
} from "../../api/client";
import { tagOf, type TagKey } from "../../mocks/agents";

/** 知识库文档：真实文档表 + KB 配置摘要/编辑 + 上传抽屉 + 元数据 Modal + 生命周期抽屉。M4 接真实 /api/documents 等。 */

const DOCS_COLS = "1fr 160px 90px 140px 160px";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_BATCH = 100;
const ALLOWED_EXT = [".pdf", ".doc", ".docx", ".md", ".markdown", ".txt"];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const linkBlue: CSSProperties = { color: "#1677ff", cursor: "pointer" };
const linkGray: CSSProperties = { color: "rgba(0,0,0,.45)", cursor: "pointer" };

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.45)",
  zIndex: 50,
};

const modalOverlay: CSSProperties = { ...overlay, zIndex: 60 };

const backBtn: CSSProperties = {
  height: 30,
  padding: "0 12px",
  border: "1px solid #d9d9d9",
  borderRadius: 6,
  background: "#fff",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  cursor: "pointer",
};

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

const summaryCard: CSSProperties = {
  background: "#fff",
  border: "1px solid #f0f0f0",
  borderRadius: 8,
  padding: "14px 18px",
  margin: "10px 0 16px",
  display: "flex",
  alignItems: "center",
  gap: 20,
  flexWrap: "wrap",
};

const typeIcon: CSSProperties = {
  width: 24,
  height: 24,
  flex: "none",
  borderRadius: 5,
  background: "#e6f4ff",
  color: "#1677ff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 600,
};

const gridHeader: CSSProperties = {
  display: "grid",
  gridTemplateColumns: DOCS_COLS,
  padding: "12px 16px",
  background: "#fafafa",
  borderBottom: "1px solid #f0f0f0",
  fontSize: 13,
  fontWeight: 600,
  color: "rgba(0,0,0,.65)",
};

const gridRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: DOCS_COLS,
  padding: "12px 16px",
  borderBottom: "1px solid #f0f0f0",
  fontSize: 13,
  alignItems: "center",
};

const docNameLink: CSSProperties = {
  fontWeight: 500,
  color: "#1677ff",
  cursor: "pointer",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const closeBtn: CSSProperties = {
  fontSize: 18,
  color: "rgba(0,0,0,.45)",
  cursor: "pointer",
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 4,
};

const drawerHeader: CSSProperties = {
  height: 56,
  flex: "none",
  borderBottom: "1px solid #f0f0f0",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 24px",
};

const drawerBody: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 24,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const drawerFooter: CSSProperties = {
  flex: "none",
  borderTop: "1px solid #f0f0f0",
  padding: "14px 24px",
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
};

function drawerRight(width: number): CSSProperties {
  return {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width,
    background: "#fff",
    zIndex: 51,
    display: "flex",
    flexDirection: "column",
    boxShadow: "-4px 0 16px rgba(0,0,0,.12)",
  };
}

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

const modalHeader: CSSProperties = drawerHeader;

const modalBody: CSSProperties = {
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 16,
  maxHeight: "70vh",
  overflowY: "auto",
};

const modalFooter: CSSProperties = drawerFooter;

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

/** 分块模板选项（对齐 KnowledgeBasesPage 创建表单，此处用于编辑）。 */
const CHUNK_TEMPLATE_OPTS: { value: ChunkTemplate; label: string; desc: string }[] = [
  { value: "general", label: "通用", desc: "按标题结构切分，适合 Markdown / TXT / 层级清晰的文档" },
  { value: "qa", label: "问答", desc: "识别问答对，一问一答作为一个切片，适合 FAQ 文档" },
];

/** 知识库状态标签（对齐 KnowledgeBasesPage.statusView）。 */
function kbStatusView(k: KnowledgeBase): { label: string; tag: TagKey } {
  if (k.status === "building") return { label: `重建中 ${k.progress ?? 0}%`, tag: "blue" };
  if (k.status === "failed") return { label: "失败", tag: "red" };
  return { label: "已就绪", tag: "green" };
}

/** 文档状态五值（DocumentStatusSchema）的展示映射：pending/queued 灰、processing 黄、failed 红、ready 绿。 */
const DOC_STATUS_VIEW: Record<DocumentStatus, { label: string; dot: string }> = {
  pending: { label: "待处理", dot: "#bfbfbf" },
  queued: { label: "排队中", dot: "#bfbfbf" },
  processing: { label: "处理中", dot: "#faad14" },
  failed: { label: "失败", dot: "#ff4d4f" },
  ready: { label: "已就绪", dot: "#52c41a" },
};

const TYPE_LABEL: Record<Document["type"], string> = {
  pdf: "PDF",
  word: "DOC",
  markdown: "MD",
  text: "TXT",
};

function fileTypeLabel(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) return "DOC";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "MD";
  return "TXT";
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 生命周期三阶段的固定文案（对齐原型 STAGE_DEFS，数据源换真实 lifecycle.stages）。 */
const STAGE_LABELS: Record<DocumentLifecycleStage["stage"], { label: string; desc: string }> = {
  upload: { label: "上传", desc: "文件校验 · 落盘存储" },
  ingest: { label: "解析入库", desc: "解析 · 切片 · 向量化写入索引" },
  ready: { label: "就绪", desc: "纳入检索 · 可被问答引用" },
};

const STAGE_VIS: Record<
  DocumentLifecycleStage["status"],
  { icon: string; c: string; bg: string; bd: string; line: string; label: string }
> = {
  done: { icon: "✓", c: "#52c41a", bg: "#f6ffed", bd: "#b7eb8f", line: "#52c41a", label: "完成" },
  running: {
    icon: "◐",
    c: "#d48806",
    bg: "#fffbe6",
    bd: "#ffe58f",
    line: "#faad14",
    label: "进行中",
  },
  failed: { icon: "✕", c: "#ff4d4f", bg: "#fff2f0", bd: "#ffccc7", line: "#ffccc7", label: "失败" },
  pending: { icon: "", c: "#bfbfbf", bg: "#fff", bd: "#e8e8e8", line: "#e8e8e8", label: "待处理" },
};

function stageDuration(s: DocumentLifecycleStage): string {
  if (!s.startedAt) return "—";
  const start = new Date(s.startedAt).getTime();
  const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
  const sec = Math.max(0, (end - start) / 1000);
  return `${sec.toFixed(1)}s`;
}

function stageTime(s: DocumentLifecycleStage): string {
  return s.startedAt ? formatDateTime(s.startedAt) : "—";
}

interface MetaRow {
  key: string;
  value: string;
}

export default function DocumentsPage() {
  const { kbId = "" } = useParams<{ kbId: string }>();
  const navigate = useNavigate();

  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 上传抽屉
  const [uploadOpen, setUploadOpen] = useState(false);
  const [autoParse, setAutoParse] = useState(true); // 007 拍板默认开，不沿用旧原型默认关
  const [folderMode, setFolderMode] = useState(false);
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);
  const [uploadErr, setUploadErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 编辑 KB 摘要
  const [editOpen, setEditOpen] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editChunkTemplate, setEditChunkTemplate] = useState<ChunkTemplate>("general");
  const [editErr, setEditErr] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // 元数据 Modal
  const [metaDoc, setMetaDoc] = useState<Document | null>(null);
  const [metaRows, setMetaRows] = useState<MetaRow[]>([]);
  const [metaErr, setMetaErr] = useState("");
  const [metaSaving, setMetaSaving] = useState(false);

  // 生命周期抽屉
  const [lifecycleDocId, setLifecycleDocId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<DocumentLifecycleResponse | null>(null);
  const [lifecycleErr, setLifecycleErr] = useState("");
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [kbs, list] = await Promise.all([getKnowledgeBases(), getDocuments(kbId)]);
      setKb(kbs.find((k) => k.id === kbId) ?? null);
      setDocs(list);
      setError("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 有文档处于处理中状态（queued/processing）时轮询，同 KnowledgeBasesPage 的按需轮询模式
  useEffect(() => {
    if (!docs.some((d) => d.status === "queued" || d.status === "processing")) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [docs, load]);

  const lifecycleDoc = lifecycleDocId ? (docs.find((d) => d.id === lifecycleDocId) ?? null) : null;

  // 生命周期抽屉打开后拉一次；对应文档状态变化（如重试后 failed -> queued）时再拉一次刷新阶段详情
  useEffect(() => {
    if (!lifecycleDocId) {
      setLifecycle(null);
      return;
    }
    let cancelled = false;
    setLifecycleLoading(true);
    setLifecycleErr("");
    getDocumentLifecycle(lifecycleDocId)
      .then((res) => {
        if (!cancelled) setLifecycle(res);
      })
      .catch((e) => {
        if (!cancelled) setLifecycleErr(errMsg(e));
      })
      .finally(() => {
        if (!cancelled) setLifecycleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lifecycleDocId, lifecycleDoc?.status]);

  const goChunks = (docId: string) =>
    navigate(
      `/admin/knowledge-bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}/chunks`,
    );

  // ---- 上传 ----

  const openUpload = () => {
    setPickedFiles([]);
    setAutoParse(true);
    setFolderMode(false);
    setUploadErr("");
    setUploading(false);
    setUploadOpen(true);
  };

  const onPickFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const all = Array.from(fileList);
    const supported = all.filter((f) =>
      ALLOWED_EXT.some((ext) => f.name.toLowerCase().endsWith(ext)),
    );
    if (supported.length === 0) {
      setUploadErr("未找到受支持的文件类型（PDF / Word / Markdown / TXT）");
      return;
    }
    if (supported.length > MAX_BATCH) {
      setUploadErr(`单批最多上传 ${MAX_BATCH} 个文件，当前选择了 ${supported.length} 个`);
      return;
    }
    const oversized = supported.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setUploadErr(`以下文件超过单文件 20MB 限制：${oversized.map((f) => f.name).join("、")}`);
      return;
    }
    setUploadErr("");
    setPickedFiles(supported);
  };

  const removePickedFile = (idx: number) =>
    setPickedFiles((prev) => prev.filter((_, i) => i !== idx));

  const confirmUpload = async () => {
    if (pickedFiles.length === 0 || uploading) return;
    setUploading(true);
    setUploadErr("");
    try {
      await uploadDocuments(kbId, pickedFiles, { autoParse });
      setUploadOpen(false);
      setPickedFiles([]);
      await load();
    } catch (e) {
      setUploadErr(errMsg(e));
    } finally {
      setUploading(false);
    }
  };

  // ---- KB 编辑（desc / chunkTemplate） ----

  const openEdit = () => {
    if (!kb) return;
    setEditDesc(kb.desc);
    setEditChunkTemplate(kb.chunkTemplate);
    setEditErr("");
    setEditSaving(false);
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!kb) return;
    const chunkTemplateChanged = editChunkTemplate !== kb.chunkTemplate;
    if (chunkTemplateChanged) {
      const ok = window.confirm(
        "修改分块模板将触发知识库全量重建：所有文档会按新模板重新解析切片，重建完成前检索仍使用旧版本索引。确认继续？",
      );
      if (!ok) return;
    }
    setEditSaving(true);
    setEditErr("");
    try {
      await updateKnowledgeBase(kbId, {
        desc: editDesc,
        ...(chunkTemplateChanged ? { chunkTemplate: editChunkTemplate } : {}),
      });
      setEditOpen(false);
      await load();
    } catch (e) {
      const msg = errMsg(e);
      setEditErr(msg.includes("409") ? "知识库正在重建中，请稍候再试" : msg);
    } finally {
      setEditSaving(false);
    }
  };

  // ---- 文档操作 ----

  const retryParse = async (docId: string) => {
    try {
      await triggerParse(docId);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const removeDoc = async (doc: Document) => {
    if (!window.confirm(`确认删除文档「${doc.name}」？`)) return;
    try {
      await deleteDocument(doc.id);
      if (lifecycleDocId === doc.id) setLifecycleDocId(null);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  // ---- 元数据 Modal ----

  const openMeta = (doc: Document) => {
    setMetaDoc(doc);
    setMetaRows(Object.entries(doc.metadata).map(([key, value]) => ({ key, value })));
    setMetaErr("");
    setMetaSaving(false);
  };

  const addMetaRow = () => setMetaRows((prev) => [...prev, { key: "", value: "" }]);
  const removeMetaRow = (idx: number) => setMetaRows((prev) => prev.filter((_, i) => i !== idx));
  const updateMetaRow = (idx: number, patch: Partial<MetaRow>) =>
    setMetaRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const submitMeta = async () => {
    if (!metaDoc) return;
    const keys = metaRows.map((r) => r.key.trim()).filter((k) => k.length > 0);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) {
      setMetaErr(`键「${dup}」重复`);
      return;
    }
    const metadata: Record<string, string> = {};
    for (const r of metaRows) {
      const k = r.key.trim();
      if (k) metadata[k] = r.value;
    }
    setMetaSaving(true);
    setMetaErr("");
    try {
      await updateDocumentMetadata(metaDoc.id, { metadata });
      setMetaDoc(null);
      await load();
    } catch (e) {
      setMetaErr(errMsg(e));
    } finally {
      setMetaSaving(false);
    }
  };

  const kbSv = kb ? kbStatusView(kb) : null;
  const kbT = kbSv ? tagOf(kbSv.tag) : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <div onClick={() => navigate("/admin/knowledge-bases")} style={backBtn}>
          ← 返回列表
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{kb?.name ?? "知识库"}</div>
        {kbSv && kbT && (
          <span
            style={{
              fontSize: 11,
              lineHeight: "18px",
              padding: "0 7px",
              borderRadius: 9,
              background: kbT.bg,
              color: kbT.c,
              border: `1px solid ${kbT.bd}`,
            }}
          >
            {kbSv.label}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div onClick={openUpload} style={btnPrimary}>
          ＋ 新增文件
        </div>
      </div>

      {error && (
        <div style={{ ...errBar, marginTop: 12 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <span style={{ ...linkBlue, flex: "none" }} onClick={() => void load()}>
            重试
          </span>
        </div>
      )}

      {kb && (
        <div style={summaryCard}>
          <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>
            分块模板：
            {CHUNK_TEMPLATE_OPTS.find((c) => c.value === kb.chunkTemplate)?.label ??
              kb.chunkTemplate}
          </div>
          <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>
            Embedding：{kb.embeddingModelId}
          </div>
          <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>文档数：{kb.docsCount}</div>
          <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>
            切片数：{kb.chunksCount.toLocaleString()}
          </div>
          <div style={{ flex: 1 }} />
          <span style={linkBlue} onClick={openEdit}>
            编辑
          </span>
        </div>
      )}

      <div
        style={{
          background: "#fff",
          border: "1px solid #f0f0f0",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div style={gridHeader}>
          <div>文档</div>
          <div>上传时间</div>
          <div>切片数</div>
          <div>处理状态</div>
          <div>操作</div>
        </div>
        {loading && (
          <div
            style={{
              padding: "40px 16px",
              textAlign: "center",
              fontSize: 13,
              color: "rgba(0,0,0,.4)",
            }}
          >
            加载中…
          </div>
        )}
        {!loading && docs.length === 0 && (
          <div
            style={{
              padding: "40px 16px",
              textAlign: "center",
              fontSize: 13,
              color: "rgba(0,0,0,.4)",
            }}
          >
            该知识库暂无文档，点击「新增文件」上传
          </div>
        )}
        {!loading &&
          docs.map((d) => {
            const sv = DOC_STATUS_VIEW[d.status];
            return (
              <div key={d.id} style={gridRow}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={typeIcon}>{TYPE_LABEL[d.type]}</div>
                  <span onClick={() => goChunks(d.id)} style={docNameLink} title={d.name}>
                    {d.name}
                  </span>
                </div>
                <div style={{ color: "rgba(0,0,0,.45)", fontSize: 12 }}>
                  {formatDateTime(d.uploadedAt)}
                </div>
                <div onClick={() => goChunks(d.id)} style={linkBlue}>
                  {d.chunksCount}
                </div>
                <div>
                  <div
                    onClick={() => setLifecycleDocId(d.id)}
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        flex: "none",
                        borderRadius: "50%",
                        background: sv.dot,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 12,
                        color: sv.dot,
                        textDecoration: "underline dotted",
                        textUnderlineOffset: 2,
                      }}
                    >
                      {sv.label}
                    </span>
                  </div>
                  {d.status === "failed" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span
                        title={d.error ?? undefined}
                        style={{
                          fontSize: 11,
                          color: "#ff4d4f",
                          maxWidth: 110,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {d.error ?? "解析失败"}
                      </span>
                      <span
                        onClick={() => void retryParse(d.id)}
                        style={{ ...linkBlue, fontSize: 11, flex: "none" }}
                      >
                        重试
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 13, color: "rgba(0,0,0,.45)" }}>
                  <span onClick={() => goChunks(d.id)} style={linkBlue}>
                    查看切片
                  </span>
                  <span onClick={() => openMeta(d)} style={linkGray}>
                    元数据
                  </span>
                  <span onClick={() => void removeDoc(d)} style={linkGray}>
                    删除
                  </span>
                </div>
              </div>
            );
          })}
      </div>

      {/* 编辑 KB Modal：desc + chunkTemplate（改分块模板触发全库重建确认） */}
      {editOpen && kb && (
        <>
          <div onClick={() => (editSaving ? undefined : setEditOpen(false))} style={modalOverlay} />
          <div style={modalCard}>
            <div style={modalHeader}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>编辑知识库配置</div>
              <div onClick={() => (editSaving ? undefined : setEditOpen(false))} style={closeBtn}>
                ×
              </div>
            </div>
            <div style={modalBody}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={fieldLabel}>描述</div>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  style={textareaStyle}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={fieldLabel}>分块模板</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {CHUNK_TEMPLATE_OPTS.map((c) => {
                    const on = editChunkTemplate === c.value;
                    return (
                      <div
                        key={c.value}
                        onClick={() => setEditChunkTemplate(c.value)}
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
                  {CHUNK_TEMPLATE_OPTS.find((c) => c.value === editChunkTemplate)?.desc}
                </div>
                {editChunkTemplate !== kb.chunkTemplate && (
                  <div style={{ fontSize: 12, color: "#d48806" }}>
                    与当前模板不同：保存后将触发知识库全量重建，重建期间检索仍使用旧版本。
                  </div>
                )}
              </div>
              {editErr && <div style={{ fontSize: 13, color: "#ff4d4f" }}>{editErr}</div>}
            </div>
            <div style={modalFooter}>
              <div onClick={() => (editSaving ? undefined : setEditOpen(false))} style={btnGhost}>
                取消
              </div>
              <div
                onClick={() => (editSaving ? undefined : void submitEdit())}
                style={{
                  ...btnPrimary,
                  height: 36,
                  padding: "0 18px",
                  opacity: editSaving ? 0.6 : 1,
                }}
              >
                {editSaving ? "保存中…" : "保存"}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 上传抽屉：多文件 + autoParse 开关（无文档级分块策略选择，分块已改为库级配置） */}
      {uploadOpen && (
        <>
          <div onClick={() => (uploading ? undefined : setUploadOpen(false))} style={overlay} />
          <div style={drawerRight(460)}>
            <div style={drawerHeader}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>上传文档 · {kb?.name ?? ""}</div>
              <div onClick={() => (uploading ? undefined : setUploadOpen(false))} style={closeBtn}>
                ×
              </div>
            </div>
            <div style={{ ...drawerBody, gap: 16 }}>
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "1.5px dashed #d9d9d9",
                  borderRadius: 8,
                  padding: "32px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: "#fafafa",
                }}
              >
                <div style={{ fontSize: 26, color: "#1677ff", marginBottom: 8 }}>⬆</div>
                <div style={{ fontSize: 14, color: "rgba(0,0,0,.75)", marginBottom: 4 }}>
                  点击选择文件
                </div>
                <div style={{ fontSize: 12, color: "rgba(0,0,0,.4)" }}>
                  支持 PDF / Word / Markdown / TXT，单文件 ≤ 20MB，单批 ≤ {MAX_BATCH} 个
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_EXT.join(",")}
                style={{ display: "none" }}
                onChange={(e) => {
                  onPickFiles(e.target.files);
                  e.target.value = "";
                }}
                // @ts-expect-error webkitdirectory 是非标准的浏览器专有属性（Chrome/Edge 支持整目录上传），
                // React 的 InputHTMLAttributes 类型未声明该属性，此处直接透传给 DOM 以支持"按文件夹上传"。
                webkitdirectory={folderMode ? "" : undefined}
              />

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "rgba(0,0,0,.65)",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={folderMode}
                  onChange={(e) => setFolderMode(e.target.checked)}
                />
                按文件夹上传（选择整个目录，自动过滤不支持的文件类型）
              </label>

              {uploadErr && <div style={{ fontSize: 12, color: "#ff4d4f" }}>{uploadErr}</div>}

              {pickedFiles.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    maxHeight: 240,
                    overflowY: "auto",
                  }}
                >
                  {pickedFiles.map((f, idx) => (
                    <div
                      key={`${f.name}-${idx}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        border: "1px solid #f0f0f0",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ ...typeIcon, width: 28, height: 28 }}>
                        {fileTypeLabel(f.name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={f.name}
                        >
                          {f.name}
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(0,0,0,.4)" }}>
                          {formatSize(f.size)}
                        </div>
                      </div>
                      <div
                        onClick={() => removePickedFile(idx)}
                        style={{ ...closeBtn, width: 22, height: 22 }}
                      >
                        ×
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: "rgba(0,0,0,.75)",
                  cursor: "pointer",
                  userSelect: "none",
                  marginTop: 4,
                }}
              >
                <input
                  type="checkbox"
                  checked={autoParse}
                  onChange={(e) => setAutoParse(e.target.checked)}
                />
                上传后立即解析
              </label>
              <div style={{ fontSize: 12, color: "rgba(0,0,0,.4)" }}>
                关闭后文档状态停留在「待处理」，需在文档表手动点击「重试」触发解析。
              </div>
            </div>
            <div style={drawerFooter}>
              <div onClick={() => (uploading ? undefined : setUploadOpen(false))} style={btnGhost}>
                取消
              </div>
              <div
                onClick={() =>
                  pickedFiles.length === 0 || uploading ? undefined : void confirmUpload()
                }
                style={{
                  height: 36,
                  padding: "0 18px",
                  background: pickedFiles.length > 0 && !uploading ? "#1677ff" : "#bfbfbf",
                  color: "#fff",
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  fontSize: 14,
                  cursor: pickedFiles.length > 0 && !uploading ? "pointer" : "not-allowed",
                }}
              >
                {uploading ? "上传中…" : "开始上传"}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 元数据 Modal：受控 key/value 列表编辑器 */}
      {metaDoc && (
        <>
          <div onClick={() => (metaSaving ? undefined : setMetaDoc(null))} style={modalOverlay} />
          <div style={modalCard}>
            <div style={modalHeader}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>文档元数据</div>
              <div onClick={() => (metaSaving ? undefined : setMetaDoc(null))} style={closeBtn}>
                ×
              </div>
            </div>
            <div style={modalBody}>
              <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }} title={metaDoc.name}>
                {metaDoc.name}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {metaRows.map((r, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      value={r.key}
                      onChange={(e) => updateMetaRow(idx, { key: e.target.value })}
                      placeholder="键"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <input
                      value={r.value}
                      onChange={(e) => updateMetaRow(idx, { value: e.target.value })}
                      placeholder="值"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <div onClick={() => removeMetaRow(idx)} style={closeBtn}>
                      ×
                    </div>
                  </div>
                ))}
                <div onClick={addMetaRow} style={{ ...linkBlue, fontSize: 13 }}>
                  ＋ 添加字段
                </div>
              </div>
              {metaErr && <div style={{ fontSize: 13, color: "#ff4d4f" }}>{metaErr}</div>}
            </div>
            <div style={modalFooter}>
              <div onClick={() => (metaSaving ? undefined : setMetaDoc(null))} style={btnGhost}>
                取消
              </div>
              <div
                onClick={() => (metaSaving ? undefined : void submitMeta())}
                style={{
                  ...btnPrimary,
                  height: 36,
                  padding: "0 18px",
                  opacity: metaSaving ? 0.6 : 1,
                }}
              >
                {metaSaving ? "保存中…" : "保存"}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 生命周期抽屉：三段进度（上传/解析入库/就绪），数据源真实 getDocumentLifecycle。
          顶部状态徽章按 document.status 映射，不按"最后一个 running 阶段"推断——
          成功路径下 ingest 阶段可能不闭合为 done，仅凭阶段数组会误判为"进行中"。 */}
      {lifecycleDoc && (
        <>
          <div onClick={() => setLifecycleDocId(null)} style={overlay} />
          <div style={drawerRight(480)}>
            <div style={drawerHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, flex: "none" }}>文档生命周期</div>
                <span
                  style={{
                    fontSize: 12,
                    lineHeight: "20px",
                    padding: "0 8px",
                    borderRadius: 4,
                    background: "#fafafa",
                    color: DOC_STATUS_VIEW[lifecycleDoc.status].dot,
                    border: `1px solid ${DOC_STATUS_VIEW[lifecycleDoc.status].dot}`,
                    flex: "none",
                  }}
                >
                  {DOC_STATUS_VIEW[lifecycleDoc.status].label}
                </span>
              </div>
              <div onClick={() => setLifecycleDocId(null)} style={closeBtn}>
                ×
              </div>
            </div>
            <div style={{ ...drawerBody, padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                <div style={typeIcon}>{TYPE_LABEL[lifecycleDoc.type]}</div>
                <div
                  style={{
                    fontSize: 13,
                    color: "rgba(0,0,0,.7)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={lifecycleDoc.name}
                >
                  {lifecycleDoc.name}
                </div>
              </div>

              {lifecycleDoc.status === "failed" && (
                <div
                  style={{
                    border: "1px solid #ffccc7",
                    background: "#fff2f0",
                    borderRadius: 8,
                    padding: "14px 16px",
                    marginBottom: 22,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          flex: "none",
                          borderRadius: "50%",
                          background: "#ff4d4f",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        ✕
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#cf1322" }}>
                        处理失败
                      </span>
                    </div>
                    <div
                      onClick={() => void retryParse(lifecycleDoc.id)}
                      style={{
                        height: 30,
                        padding: "0 14px",
                        background: "#ff4d4f",
                        color: "#fff",
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        fontSize: 13,
                        cursor: "pointer",
                        userSelect: "none",
                        flex: "none",
                      }}
                    >
                      重新解析
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#874d00", lineHeight: 1.7, marginTop: 8 }}>
                    {lifecycleDoc.error ?? "文档处理失败，请重试或联系管理员。"}
                  </div>
                </div>
              )}

              {lifecycleLoading && (
                <div style={{ fontSize: 13, color: "rgba(0,0,0,.45)" }}>加载中…</div>
              )}
              {lifecycleErr && (
                <div style={{ fontSize: 13, color: "#ff4d4f", marginBottom: 12 }}>
                  {lifecycleErr}
                </div>
              )}

              {lifecycle && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {lifecycle.stages.map((s, i) => {
                    const def = STAGE_LABELS[s.stage];
                    const v = STAGE_VIS[s.status];
                    const notLast = i !== lifecycle.stages.length - 1;
                    return (
                      <div key={s.stage} style={{ display: "flex", gap: 14 }}>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            flex: "none",
                          }}
                        >
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              flex: "none",
                              borderRadius: "50%",
                              background: v.bg,
                              border: `1.5px solid ${v.bd}`,
                              color: v.c,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 13,
                              fontWeight: 700,
                            }}
                          >
                            {v.icon || String(i + 1)}
                          </div>
                          {notLast && (
                            <div style={{ width: 2, flex: 1, minHeight: 30, background: v.line }} />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0, paddingBottom: 20 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>{def.label}</span>
                            <span
                              style={{
                                fontSize: 11,
                                lineHeight: "18px",
                                padding: "0 7px",
                                borderRadius: 9,
                                background: v.bg,
                                color: v.c,
                                border: `1px solid ${v.bd}`,
                              }}
                            >
                              {v.label}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)", marginTop: 3 }}>
                            {def.desc}
                          </div>
                          <div style={{ fontSize: 12, color: "rgba(0,0,0,.35)", marginTop: 5 }}>
                            耗时 {stageDuration(s)} · {stageTime(s)}
                          </div>
                          {s.status === "failed" && s.error && (
                            <div style={{ fontSize: 12, color: "#ff4d4f", marginTop: 5 }}>
                              {s.error}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
