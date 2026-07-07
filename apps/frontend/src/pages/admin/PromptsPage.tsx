import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  diffPromptBodies,
  extractVars,
  renderTemplate,
  type Prompt,
  type PromptNode,
  type PromptVersion,
} from "@codecrush/contracts";
import {
  createPrompt,
  createPromptVersion,
  getPromptVersions,
  getPrompts,
  publishPromptVersion,
  rollbackPromptVersion,
} from "../../api/client";
import {
  NODE_LABEL,
  NODE_META,
  NODE_TAGS,
  STATUS_LABEL,
  STV,
  VAR_PH,
} from "../../mocks/prompts";
import { tagOf } from "../../mocks/agents";

/** Prompt 管理：列表 + 编辑抽屉（变量识别/预览）+ 版本管理抽屉（Diff/绑定）。M6 接真实 /api/prompts。 */

const COLS = "1fr 130px 110px 190px 150px";

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

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.45)",
  zIndex: 50,
};

const linkBlue: CSSProperties = { color: "#1677ff", cursor: "pointer" };

const inputStyle: CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid #d9d9d9",
  borderRadius: 6,
  fontSize: 14,
  outline: "none",
  width: "100%",
};

const selectStyle: CSSProperties = {
  height: 38,
  padding: "0 10px",
  border: "1px solid #d9d9d9",
  borderRadius: 6,
  fontSize: 14,
  outline: "none",
  background: "#fff",
  width: "100%",
};

const mono: CSSProperties = { fontFamily: "ui-monospace, Menlo, monospace" };

/** ISO datetime → "MM-DD HH:mm"（本地时区，对齐原型展示）。 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 版本号展示：v1 / v2 … */
function verLabel(v: number): string {
  return `v${v}`;
}

/** 编辑/新建抽屉表单。新建走 createPrompt；编辑走 createPromptVersion（基于现有版本出新 draft）。 */
interface PromptDraft {
  isNew: boolean;
  promptId: string; // 新建时为 ""
  name: string;
  node: PromptNode;
  body: string;
  note: string;
  varExamples: Record<string, string>;
  verLabel: string; // 抽屉标题右侧版本徽标
  updatedByLabel: string; // 底部"上次更新"文案
}

export default function PromptsPage() {
  const [rows, setRows] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState("");

  const [drawer, setDrawer] = useState(false);
  const [pf, setPf] = useState<PromptDraft | null>(null);
  const [pfErr, setPfErr] = useState("");
  const [pfSaving, setPfSaving] = useState(false);

  // 版本管理抽屉
  const [verPromptId, setVerPromptId] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [verLoading, setVerLoading] = useState(false);
  const [verErr, setVerErr] = useState("");
  const [pvSelVer, setPvSelVer] = useState<string | null>(null);
  const [pvTab, setPvTab] = useState<"diff" | "bind">("diff");

  const refreshList = async () => {
    setLoading(true);
    setListErr("");
    try {
      setRows(await getPrompts());
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshList();
  }, []);

  const refreshVersions = async (promptId: string) => {
    setVerLoading(true);
    setVerErr("");
    try {
      setVersions(await getPromptVersions(promptId));
    } catch (e) {
      setVerErr(e instanceof Error ? e.message : "加载版本失败");
    } finally {
      setVerLoading(false);
    }
  };

  useEffect(() => {
    if (!verPromptId) return;
    void refreshVersions(verPromptId);
    setPvSelVer(null);
    setPvTab("diff");
  }, [verPromptId]);

  const patchPf = (patch: Partial<PromptDraft>) => {
    setPf(prev => (prev ? { ...prev, ...patch } : prev));
    setPfErr("");
  };

  const openNew = () => {
    setPf({
      isNew: true,
      promptId: "",
      name: "",
      node: "reply",
      body: "",
      note: "",
      varExamples: {},
      verLabel: "新建 v1",
      updatedByLabel: "—",
    });
    setPfErr("");
    setDrawer(true);
  };

  const openEdit = async (r: Prompt) => {
    setPfErr("");
    setDrawer(true);
    // 取当前 prod 版本 body 作为新版本起点；无 prod 则取最新版本
    setPf({
      isNew: false,
      promptId: r.id,
      name: r.name,
      node: r.node,
      body: "",
      note: "",
      varExamples: {},
      verLabel: "加载中…",
      updatedByLabel: `上次更新：${r.updatedBy} · ${formatDateTime(r.updatedAt)}`,
    });
    try {
      const vs = await getPromptVersions(r.id);
      const prod = vs.find(v => v.status === "prod") ?? vs[0];
      setPf(prev =>
        prev
          ? {
              ...prev,
              body: prod?.body ?? "",
              verLabel: prod ? `基于 ${verLabel(prod.version)} 编辑` : "新建 v1",
            }
          : prev,
      );
    } catch (e) {
      setPf(prev =>
        prev ? { ...prev, verLabel: "加载版本失败" } : prev,
      );
      void e;
    }
  };

  const save = async () => {
    if (!pf) return;
    const name = pf.name.trim();
    if (!name) {
      setPfErr("请填写 Prompt 名称");
      return;
    }
    if (!pf.body.trim()) {
      setPfErr("请填写 Prompt 内容");
      return;
    }
    setPfSaving(true);
    setPfErr("");
    try {
      if (pf.isNew) {
        await createPrompt({ name, node: pf.node, body: pf.body, note: pf.note || undefined });
      } else {
        await createPromptVersion(pf.promptId, { body: pf.body, note: pf.note || undefined });
      }
      setDrawer(false);
      await refreshList();
    } catch (e) {
      setPfErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPfSaving(false);
    }
  };

  const insertVar = (v: string) => {
    if (!pf) return;
    const body = pf.body ? pf.body + (/\s$/.test(pf.body) ? "" : " ") + v : v;
    patchPf({ body });
  };

  // 版本管理抽屉：发布 draft 或回滚 archived
  const actOnVersion = async (v: PromptVersion) => {
    if (!verPromptId) return;
    setVerErr("");
    try {
      if (v.status === "draft") {
        await publishPromptVersion(verPromptId, v.id);
      } else {
        await rollbackPromptVersion(verPromptId, v.id);
      }
      await refreshVersions(verPromptId);
      await refreshList();
    } catch (e) {
      setVerErr(e instanceof Error ? e.message : v.status === "draft" ? "发布失败" : "回滚失败");
    }
  };

  // 版本管理抽屉派生量
  const ver = useMemo(() => {
    if (!verPromptId) return null;
    const prompt = rows.find(r => r.id === verPromptId);
    const sorted = [...versions].sort((a, b) => b.version - a.version); // 最新在前
    const prodVersion = sorted.find(v => v.status === "prod");
    const selVersion = sorted.find(v => v.id === pvSelVer) ?? sorted[0] ?? null;
    const diff =
      prodVersion && selVersion
        ? diffPromptBodies(prodVersion.body, selVersion.body).map(d => ({
            text: d.text || " ",
            sign: d.type === "add" ? "+" : d.type === "del" ? "−" : " ",
            bg: d.type === "add" ? "#f6ffed" : d.type === "del" ? "#fff2f0" : "transparent",
            color: d.type === "add" ? "#237804" : d.type === "del" ? "#a8071a" : "rgba(0,0,0,.7)",
            signC: d.type === "add" ? "#52c41a" : d.type === "del" ? "#ff4d4f" : "rgba(0,0,0,.25)",
          }))
        : [];
    const adds = diff.filter(d => d.sign === "+").length;
    const dels = diff.filter(d => d.sign === "−").length;
    const sameVer = !!prodVersion && !!selVersion && prodVersion.id === selVersion.id;
    const selStatus = selVersion?.status;
    const canPublishSel = !!selVersion && selStatus !== "prod";
    const publishSelLabel = selVersion
      ? selStatus === "draft"
        ? `发布上线 ${verLabel(selVersion.version)}`
        : `回滚到 ${verLabel(selVersion.version)}`
      : "";
    return {
      prompt,
      versions: sorted,
      prodVersion,
      selVersion,
      diff,
      diffFrom: prodVersion ? verLabel(prodVersion.version) : "—",
      diffTo: selVersion ? verLabel(selVersion.version) : "—",
      sameVer,
      adds,
      dels,
      canPublishSel,
      publishSelLabel,
    };
  }, [verPromptId, rows, versions, pvSelVer]);

  const pfMeta = pf ? NODE_META[pf.node] : null;
  const pfDetected = pf ? extractVars(pf.body).map(v => `{${v}}`) : [];
  const pfPreview = pf ? renderTemplate(pf.body, pf.varExamples) : "";

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600 }}>Prompt 管理</div>
        <div onClick={openNew} style={btnPrimary}>
          ＋ 新建 Prompt
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #f0f0f0",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: COLS,
            padding: "12px 16px",
            background: "#fafafa",
            borderBottom: "1px solid #f0f0f0",
            fontSize: 13,
            fontWeight: 600,
            color: "rgba(0,0,0,.65)",
          }}
        >
          <div>Prompt 名称</div>
          <div>所属节点</div>
          <div>状态</div>
          <div>更新人 / 时间</div>
          <div>操作</div>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "rgba(0,0,0,.45)", fontSize: 13 }}>
            加载中…
          </div>
        ) : listErr ? (
          <div style={{ padding: 32, textAlign: "center", color: "#ff4d4f", fontSize: 13 }}>
            {listErr}
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "rgba(0,0,0,.35)", fontSize: 13 }}>
            暂无 Prompt，点击右上角「新建 Prompt」创建第一个
          </div>
        ) : (
          rows.map(r => {
            const t = tagOf(NODE_TAGS[r.node]);
            const isProd = r.currentVersionId != null;
            const st = isProd ? STV.prod : STV.draft;
            return (
              <div
                key={r.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: COLS,
                  padding: "12px 16px",
                  borderBottom: "1px solid #f0f0f0",
                  fontSize: 13,
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 500 }}>{r.name}</div>
                <div>
                  <span
                    style={{
                      fontSize: 12,
                      lineHeight: "20px",
                      padding: "0 8px",
                      borderRadius: 4,
                      background: t.bg,
                      color: t.c,
                      border: `1px solid ${t.bd}`,
                    }}
                  >
                    {NODE_LABEL[r.node]}
                  </span>
                </div>
                <div>
                  <span
                    style={{
                      fontSize: 12,
                      lineHeight: "20px",
                      padding: "0 8px",
                      borderRadius: 4,
                      background: st.bg,
                      color: st.c,
                      border: `1px solid ${st.bd}`,
                    }}
                  >
                    {isProd ? STATUS_LABEL.prod : STATUS_LABEL.draft}
                  </span>
                </div>
                <div style={{ color: "rgba(0,0,0,.55)" }}>
                  {r.updatedBy} · {formatDateTime(r.updatedAt)}
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
                  <span style={linkBlue} onClick={() => void openEdit(r)}>
                    编辑
                  </span>
                  <span
                    style={linkBlue}
                    onClick={() => {
                      setVerPromptId(r.id);
                    }}
                  >
                    版本历史
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {drawer && pf && (
        <>
          <div onClick={() => setDrawer(false)} style={overlay} />
          <div style={drawerRight(720)}>
            <div style={drawerHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {pf.isNew ? "新建 Prompt" : "编辑 Prompt"}
                </div>
                <span
                  style={{
                    fontSize: 12,
                    lineHeight: "20px",
                    padding: "0 8px",
                    borderRadius: 4,
                    background: "#f5f5f5",
                    color: "rgba(0,0,0,.55)",
                    border: "1px solid #e8e8e8",
                  }}
                >
                  {pf.verLabel}
                </span>
              </div>
              <div onClick={() => setDrawer(false)} style={closeBtn}>
                ×
              </div>
            </div>
            <div style={drawerBody}>
              <div style={{ display: "flex", gap: 14 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>Prompt 名称</div>
                  <input
                    value={pf.name}
                    onChange={e => patchPf({ name: e.target.value })}
                    placeholder="如：售后回复生成"
                    style={inputStyle}
                  />
                </div>
                <div style={{ width: 200, flex: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>所属节点</div>
                  <select
                    value={pf.node}
                    onChange={e => patchPf({ node: e.target.value as PromptNode })}
                    style={selectStyle}
                  >
                    {(Object.keys(NODE_TAGS) as PromptNode[]).map(n => (
                      <option key={n} value={n}>
                        {NODE_LABEL[n]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {pfMeta && (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    background: "#fafafa",
                    border: "1px solid #f0f0f0",
                    borderRadius: 6,
                    padding: "9px 12px",
                    marginTop: -8,
                  }}
                >
                  <span style={{ fontSize: 12, lineHeight: "18px", color: "#1677ff", flex: "none" }}>
                    ⓘ
                  </span>
                  <div style={{ fontSize: 12, color: "rgba(0,0,0,.5)", lineHeight: 1.6 }}>{pfMeta.hint}</div>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>Prompt 内容</div>
                  <div style={{ fontSize: 12, color: "rgba(0,0,0,.4)" }}>
                    用 <span style={mono}>{`{变量名}`}</span> 插入动态内容
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "rgba(0,0,0,.45)" }}>推荐变量</span>
                  {pfMeta?.vars.map(v => (
                    <div
                      key={v}
                      onClick={() => insertVar(v)}
                      style={{
                        fontSize: 12,
                        lineHeight: "24px",
                        height: 24,
                        padding: "0 9px",
                        borderRadius: 6,
                        border: "1px solid #91caff",
                        background: "#e6f4ff",
                        color: "#1677ff",
                        cursor: "pointer",
                        ...mono,
                        userSelect: "none",
                      }}
                    >
                      + {v}
                    </div>
                  ))}
                </div>
                <textarea
                  value={pf.body}
                  onChange={e => patchPf({ body: e.target.value })}
                  placeholder="在此编写 Prompt 模板…"
                  style={{
                    height: 220,
                    padding: "12px 14px",
                    border: "1px solid #d9d9d9",
                    borderRadius: 6,
                    fontSize: 13,
                    lineHeight: 1.8,
                    outline: "none",
                    resize: "none",
                    ...mono,
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>变量</div>
                  <span
                    style={{
                      fontSize: 11,
                      lineHeight: "18px",
                      padding: "0 7px",
                      borderRadius: 9,
                      background: "#f5f5f5",
                      color: "rgba(0,0,0,.5)",
                      border: "1px solid #e8e8e8",
                    }}
                  >
                    自动识别 {pfDetected.length}
                  </span>
                </div>
                {pfDetected.length > 0 ? (
                  <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden" }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "190px 1fr",
                        padding: "9px 14px",
                        background: "#fafafa",
                        borderBottom: "1px solid #f0f0f0",
                        fontSize: 12,
                        color: "rgba(0,0,0,.55)",
                      }}
                    >
                      <div>变量</div>
                      <div>示例值 · 用于预览</div>
                    </div>
                    {pfDetected.map(v => (
                      <div
                        key={v}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "190px 1fr",
                          padding: "8px 14px",
                          borderBottom: "1px solid #f5f5f5",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div style={{ ...mono, fontSize: 12.5, color: "#1677ff" }}>{v}</div>
                        <input
                          value={pf.varExamples[v] || ""}
                          onChange={e =>
                            patchPf({
                              varExamples: { ...pf.varExamples, [v]: e.target.value },
                            })
                          }
                          placeholder={VAR_PH[v] || "示例值"}
                          style={{
                            height: 30,
                            padding: "0 10px",
                            border: "1px solid #e8e8e8",
                            borderRadius: 5,
                            fontSize: 12.5,
                            outline: "none",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      border: "1px dashed #e8e8e8",
                      borderRadius: 8,
                      padding: 14,
                      textAlign: "center",
                      fontSize: 12,
                      color: "rgba(0,0,0,.35)",
                    }}
                  >
                    暂未检测到变量，在内容里用 {`{变量名}`} 语法插入即可自动识别
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>预览</div>
                  <div style={{ fontSize: 12, color: "rgba(0,0,0,.4)" }}>已用示例值填充变量</div>
                </div>
                <div
                  style={{
                    border: "1px solid #f0f0f0",
                    borderRadius: 8,
                    background: "#fafafa",
                    padding: "12px 14px",
                    ...mono,
                    fontSize: 12.5,
                    lineHeight: 1.9,
                    color: "rgba(0,0,0,.8)",
                    whiteSpace: "pre-wrap",
                    maxHeight: 200,
                    overflowY: "auto",
                  }}
                >
                  {pfPreview}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)" }}>
                  版本说明 <span style={{ color: "rgba(0,0,0,.4)" }}>记录本次修改，便于回溯</span>
                </div>
                <input
                  value={pf.note}
                  onChange={e => patchPf({ note: e.target.value })}
                  placeholder="如：补充引用标注要求，扩展兜底话术"
                  style={{ ...inputStyle, height: 36, fontSize: 13 }}
                />
              </div>
            </div>
            <div style={drawerFooterSpace}>
              <div>
                {pfErr ? (
                  <span style={{ fontSize: 13, color: "#ff4d4f" }}>{pfErr}</span>
                ) : (
                  <span style={{ fontSize: 13, color: "rgba(0,0,0,.45)" }}>{pf.updatedByLabel}</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div onClick={() => setDrawer(false)} style={btnGhost}>
                  取消
                </div>
                <div
                  onClick={() => void save()}
                  style={{ ...btnPrimary, opacity: pfSaving ? 0.6 : 1, pointerEvents: pfSaving ? "none" : "auto" }}
                >
                  {pfSaving ? "保存中…" : pf.isNew ? "创建 Prompt" : "保存为新版本"}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {verPromptId && ver && (
        <>
          <div onClick={() => setVerPromptId(null)} style={overlay} />
          <div style={drawerRight(760)}>
            <div style={drawerHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>版本管理</div>
                <span style={{ fontSize: 13, color: "rgba(0,0,0,.55)" }}>{ver.prompt?.name ?? "—"}</span>
                {ver.prompt && (
                  <span
                    style={{
                      fontSize: 12,
                      lineHeight: "20px",
                      padding: "0 8px",
                      borderRadius: 4,
                      background: "#f5f5f5",
                      color: "rgba(0,0,0,.55)",
                      border: "1px solid #e8e8e8",
                    }}
                  >
                    {NODE_LABEL[ver.prompt.node]}
                  </span>
                )}
              </div>
              <div onClick={() => setVerPromptId(null)} style={closeBtn}>
                ×
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
              <div
                style={{
                  width: 264,
                  flex: "none",
                  borderRight: "1px solid #f0f0f0",
                  overflowY: "auto",
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)", padding: "0 2px" }}>
                  版本历史 · 点击对比
                </div>
                {verLoading ? (
                  <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)", padding: 8 }}>加载中…</div>
                ) : ver.versions.length === 0 ? (
                  <div style={{ fontSize: 12, color: "rgba(0,0,0,.35)", padding: 8 }}>暂无版本</div>
                ) : (
                  ver.versions.map(v => {
                    const st = STV[v.status];
                    const selected = (ver.selVersion?.id ?? null) === v.id;
                    const isProd = v.status === "prod";
                    const actionLabel = !isProd
                      ? v.status === "draft"
                        ? "发布上线"
                        : "回滚到此版本"
                      : null;
                    return (
                      <div
                        key={v.id}
                        onClick={() => setPvSelVer(v.id)}
                        style={{
                          border: `1px solid ${selected ? "#1677ff" : "#f0f0f0"}`,
                          background: selected ? "#e6f4ff" : "#fff",
                          borderRadius: 8,
                          padding: "10px 12px",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, ...mono }}>{verLabel(v.version)}</span>
                          <span
                            style={{
                              fontSize: 11,
                              lineHeight: "18px",
                              padding: "0 7px",
                              borderRadius: 9,
                              background: st.bg,
                              color: st.c,
                              border: `1px solid ${st.bd}`,
                            }}
                          >
                            {STATUS_LABEL[v.status]}
                          </span>
                        </div>
                        <div
                          style={{ fontSize: 12, color: "rgba(0,0,0,.6)", lineHeight: 1.5, marginBottom: 5 }}
                        >
                          {v.note || "（无说明）"}
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(0,0,0,.35)" }}>
                          {v.author} · {formatDateTime(v.createdAt)}
                        </div>
                        {actionLabel && (
                          <div
                            onClick={e => {
                              e.stopPropagation();
                              void actOnVersion(v);
                            }}
                            style={{
                              fontSize: 12,
                              color: "#1677ff",
                              cursor: "pointer",
                              fontWeight: 500,
                              marginTop: 8,
                            }}
                          >
                            {actionLabel}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", gap: 4, padding: "16px 20px 0" }}>
                  <div onClick={() => setPvTab("diff")} style={tabStyle(pvTab === "diff")}>
                    版本 Diff
                  </div>
                  <div onClick={() => setPvTab("bind")} style={tabStyle(pvTab === "bind")}>
                    绑定 Agent
                  </div>
                </div>
                {verErr && (
                  <div style={{ padding: "8px 20px 0", fontSize: 12, color: "#ff4d4f" }}>{verErr}</div>
                )}
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", minHeight: 0 }}>
                  {pvTab === "diff" ? (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          marginBottom: 12,
                          fontSize: 13,
                        }}
                      >
                        <span style={{ color: "rgba(0,0,0,.55)" }}>对比</span>
                        <span style={{ ...mono, fontWeight: 600 }}>{ver.diffFrom}</span>
                        <span style={{ color: "rgba(0,0,0,.35)" }}>（生产）→</span>
                        <span style={{ ...mono, fontWeight: 600, color: "#1677ff" }}>{ver.diffTo}</span>
                        <div style={{ flex: 1 }} />
                        <span style={{ fontSize: 12, color: "#52c41a" }}>+{ver.adds}</span>
                        <span style={{ fontSize: 12, color: "#ff4d4f" }}>−{ver.dels}</span>
                      </div>
                      {ver.sameVer ? (
                        <div
                          style={{
                            padding: 40,
                            textAlign: "center",
                            color: "rgba(0,0,0,.35)",
                            fontSize: 13,
                          }}
                        >
                          选中的是当前生产版本，请在左侧选择其他版本进行对比。
                        </div>
                      ) : ver.selVersion == null ? (
                        <div
                          style={{
                            padding: 40,
                            textAlign: "center",
                            color: "rgba(0,0,0,.35)",
                            fontSize: 13,
                          }}
                        >
                          暂无版本可对比。
                        </div>
                      ) : (
                        <div
                          style={{
                            border: "1px solid #f0f0f0",
                            borderRadius: 8,
                            overflow: "hidden",
                            ...mono,
                            fontSize: 12.5,
                            lineHeight: 1.9,
                          }}
                        >
                          {ver.diff.map((d, i) => (
                            <div key={i} style={{ display: "flex", background: d.bg }}>
                              <span
                                style={{
                                  flex: "none",
                                  width: 22,
                                  textAlign: "center",
                                  color: d.signC,
                                  userSelect: "none",
                                }}
                              >
                                {d.sign}
                              </span>
                              <span
                                style={{
                                  flex: 1,
                                  whiteSpace: "pre-wrap",
                                  color: d.color,
                                  paddingRight: 12,
                                }}
                              >
                                {d.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {ver.canPublishSel && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            marginTop: 16,
                            borderTop: "1px solid #f0f0f0",
                            paddingTop: 16,
                          }}
                        >
                          <div style={{ fontSize: 12, color: "rgba(0,0,0,.5)", lineHeight: 1.6 }}>
                            确认变更后可直接发布上线，原生产版本将自动归档，可随时回滚。
                          </div>
                          <div
                            onClick={() => {
                              if (ver.selVersion) void actOnVersion(ver.selVersion);
                            }}
                            style={{ ...btnPrimary, height: 34 }}
                          >
                            {ver.publishSelLabel}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          fontSize: 13,
                          color: "rgba(0,0,0,.6)",
                          lineHeight: 1.7,
                          marginBottom: 16,
                        }}
                      >
                        以下 Agent 版本绑定了该 Prompt。发布新版本前请确认对这些 Agent 的影响。
                      </div>
                      <div
                        style={{
                          padding: 40,
                          textAlign: "center",
                          color: "rgba(0,0,0,.35)",
                          fontSize: 13,
                          border: "1px dashed #e8e8e8",
                          borderRadius: 8,
                        }}
                      >
                        M7 Agent 管理接入后展示绑定关系
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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
  gap: 20,
};

const drawerFooterSpace: CSSProperties = {
  flex: "none",
  borderTop: "1px solid #f0f0f0",
  padding: "14px 24px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
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

function tabStyle(on: boolean): CSSProperties {
  return {
    height: 32,
    padding: "0 14px",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
    userSelect: "none",
    background: on ? "#1677ff" : "#f5f5f5",
    color: on ? "#fff" : "rgba(0,0,0,.65)",
    display: "flex",
    alignItems: "center",
  };
}
