import { useMemo, useState, type CSSProperties } from "react";
import {
  PROMPT_ROWS,
  PROMPT_BODIES,
  PROMPT_VERS,
  NODE_TAGS,
  NODE_META,
  VAR_PH,
  STV,
  newPromptDraft,
  editPromptDraft,
  detectVars,
  previewBody,
  lineDiff,
  bodyOf,
  type PromptDraft,
  type PromptNode,
  type PromptRow,
} from "../../mocks/prompts";
import { tagOf } from "../../mocks/agents";

/** Prompt 管理：列表 + 编辑抽屉（变量识别/预览）+ 版本管理抽屉（Diff/绑定）。M6 接真实 /api/prompts。 */

const COLS = "200px 120px 80px 1fr 150px 150px";

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
const linkGray: CSSProperties = { color: "rgba(0,0,0,.45)", cursor: "pointer" };

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

export default function PromptsPage() {
  const [rows, setRows] = useState<PromptRow[]>(PROMPT_ROWS);
  const [bodies, setBodies] = useState<Record<string, string>>(PROMPT_BODIES);
  const [drawer, setDrawer] = useState(false);
  const [pf, setPf] = useState<PromptDraft | null>(null);
  const [pfErr, setPfErr] = useState("");
  const [verName, setVerName] = useState<string | null>(null);
  const [pvSelVer, setPvSelVer] = useState<string | null>(null);
  const [pvTab, setPvTab] = useState<"diff" | "bind">("diff");
  const [prod, setProd] = useState<Record<string, string>>({});

  const patchPf = (patch: Partial<PromptDraft>) => {
    setPf(prev => (prev ? { ...prev, ...patch } : prev));
    setPfErr("");
  };

  const openNew = () => {
    setPf(newPromptDraft());
    setPfErr("");
    setDrawer(true);
  };

  const openEdit = (r: PromptRow) => {
    setPf(editPromptDraft(r, bodies[r.name] || ""));
    setPfErr("");
    setDrawer(true);
  };

  const save = () => {
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
    if (pf.isNew && rows.some(r => r.name === name)) {
      setPfErr("该名称已存在");
      return;
    }
    const found = pf.body.match(/\{[a-zA-Z_]+\}/g) || [];
    const varsStr = [...new Set(found)].join(" ") || pf.vars;
    const tag = NODE_TAGS[pf.node];
    if (pf.isNew) {
      setRows(prev => [
        { name, node: pf.node, tag, ver: "v1", vars: varsStr, by: "刘敏 · 刚刚" },
        ...prev,
      ]);
      setBodies(prev => ({ ...prev, [name]: pf.body }));
    } else {
      setRows(prev =>
        prev.map(r => {
          if (r.name !== pf.orig) return r;
          return {
            ...r,
            name,
            node: pf.node,
            tag,
            ver: "v" + (parseInt((r.ver || "v1").slice(1)) + 1),
            vars: varsStr,
            by: "刘敏 · 刚刚",
          };
        })
      );
      setBodies(prev => {
        const next = { ...prev };
        if (pf.orig !== name) delete next[pf.orig];
        next[name] = pf.body;
        return next;
      });
    }
    setDrawer(false);
  };

  const insertVar = (v: string) => {
    if (!pf) return;
    const body = pf.body ? pf.body + (/\s$/.test(pf.body) ? "" : " ") + v : v;
    patchPf({ body });
  };

  const ver = useMemo(() => {
    if (!verName) return null;
    const pvName = verName;
    const cfg = PROMPT_VERS[pvName];
    const prow = rows.find(r => r.name === pvName);
    const raw = cfg
      ? cfg.versions.slice()
      : [
          {
            ver: prow?.ver || "v1",
            status: "生产中" as const,
            by: (prow?.by || "").split(" · ")[0] || "—",
            time: (prow?.by || "").split(" · ")[1] || "—",
            note: "当前线上版本",
            body: bodies[pvName] || "",
          },
          {
            ver: "v" + Math.max(1, parseInt((prow?.ver || "v2").slice(1)) - 1),
            status: "已归档" as const,
            by: "陈磊",
            time: "06-10 09:00",
            note: "历史版本",
            body: (bodies[pvName] || "") + "\n（旧版）",
          },
        ];
    const prodOverride = prod[pvName];
    const prodVer = prodOverride || (raw.find(v => v.status === "生产中") || raw[0]).ver;
    const versions = raw.map(v => {
      let status = v.status;
      if (prodOverride) {
        status = v.ver === prodOverride ? "生产中" : v.status === "生产中" ? "已归档" : v.status;
      }
      const selected = (pvSelVer || raw[0].ver) === v.ver;
      const isProd = status === "生产中";
      const st = STV[status];
      return {
        ver: v.ver,
        status,
        stBg: st.bg,
        stC: st.c,
        stBd: st.bd,
        by: v.by,
        time: v.time,
        note: v.note,
        isProd,
        selBg: selected ? "#e6f4ff" : "#fff",
        selBd: selected ? "#1677ff" : "#f0f0f0",
        hasAction: !isProd,
        actionLabel: status === "草稿" ? "发布上线" : "回滚到此版本",
        onSelect: () => setPvSelVer(v.ver),
        onAction: () => setProd(prev => ({ ...prev, [pvName]: v.ver })),
      };
    });
    const selVer = pvSelVer || raw[0].ver;
    const selRaw = raw.find(v => v.ver === selVer) || raw[0];
    const prodRaw = raw.find(v => v.ver === prodVer) || raw[0];
    const diff = lineDiff(bodyOf(prodRaw), bodyOf(selRaw)).map(d => ({
      text: d.text || " ",
      sign: d.type === "add" ? "+" : d.type === "del" ? "−" : " ",
      bg: d.type === "add" ? "#f6ffed" : d.type === "del" ? "#fff2f0" : "transparent",
      color: d.type === "add" ? "#237804" : d.type === "del" ? "#a8071a" : "rgba(0,0,0,.7)",
      signC: d.type === "add" ? "#52c41a" : d.type === "del" ? "#ff4d4f" : "rgba(0,0,0,.25)",
    }));
    const adds = diff.filter(d => d.sign === "+").length;
    const dels = diff.filter(d => d.sign === "−").length;
    const selStatus = (versions.find(v => v.ver === selVer) || {}).status;
    const bind = cfg?.bind || [
      { agent: prow?.node ? "默认 Agent" : "—", av: "v1", pv: prodVer },
    ];
    return {
      name: pvName,
      node: prow?.node || "",
      versions,
      diff,
      diffFrom: prodVer,
      diffTo: selVer,
      sameVer: prodVer === selVer,
      adds,
      dels,
      bind,
      canPublishSel: prodVer !== selVer,
      publishSelLabel: (selStatus === "草稿" ? "发布上线 " : "回滚到 ") + selVer,
      onPublishSel: () => setProd(prev => ({ ...prev, [pvName]: selVer })),
    };
  }, [verName, rows, bodies, prod, pvSelVer]);

  const pfMeta = pf ? NODE_META[pf.node] : null;
  const pfDetected = pf ? detectVars(pf.body) : [];
  const pfPreview = pf ? previewBody(pf.body, pf.varExamples) : "";

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
          <div>当前版本</div>
          <div>变量</div>
          <div>更新人 / 时间</div>
          <div>操作</div>
        </div>
        {rows.map(r => {
          const t = tagOf(r.tag);
          return (
            <div
              key={r.name}
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
                  {r.node}
                </span>
              </div>
              <div>{r.ver}</div>
              <div style={{ ...mono, fontSize: 12, color: "rgba(0,0,0,.55)" }}>{r.vars}</div>
              <div style={{ color: "rgba(0,0,0,.45)" }}>{r.by}</div>
              <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
                <span style={linkBlue} onClick={() => openEdit(r)}>
                  编辑
                </span>
                <span style={linkBlue} onClick={() => { setVerName(r.name); setPvSelVer(null); setPvTab("diff"); }}>
                  版本历史
                </span>
                <span style={linkGray}>发布</span>
              </div>
            </div>
          );
        })}
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
                  {pf.ver}
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
                        {n}
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
                  <span style={{ fontSize: 13, color: "rgba(0,0,0,.45)" }}>上次更新：{pf.by}</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div onClick={() => setDrawer(false)} style={btnGhost}>
                  取消
                </div>
                <div onClick={save} style={btnPrimary}>
                  {pf.isNew ? "创建 Prompt" : "保存为新版本"}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {verName && ver && (
        <>
          <div onClick={() => setVerName(null)} style={overlay} />
          <div style={drawerRight(760)}>
            <div style={drawerHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>版本管理</div>
                <span style={{ fontSize: 13, color: "rgba(0,0,0,.55)" }}>{ver.name}</span>
                {ver.node && (
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
                    {ver.node}
                  </span>
                )}
              </div>
              <div onClick={() => setVerName(null)} style={closeBtn}>
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
                {ver.versions.map(v => (
                  <div
                    key={v.ver}
                    onClick={v.onSelect}
                    style={{
                      border: `1px solid ${v.selBd}`,
                      background: v.selBg,
                      borderRadius: 8,
                      padding: "10px 12px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, ...mono }}>{v.ver}</span>
                      <span
                        style={{
                          fontSize: 11,
                          lineHeight: "18px",
                          padding: "0 7px",
                          borderRadius: 9,
                          background: v.stBg,
                          color: v.stC,
                          border: `1px solid ${v.stBd}`,
                        }}
                      >
                        {v.status}
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 12, color: "rgba(0,0,0,.6)", lineHeight: 1.5, marginBottom: 5 }}
                    >
                      {v.note}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(0,0,0,.35)" }}>
                      {v.by} · {v.time}
                    </div>
                    {v.hasAction && (
                      <div
                        onClick={e => {
                          e.stopPropagation();
                          v.onAction();
                        }}
                        style={{
                          fontSize: 12,
                          color: "#1677ff",
                          cursor: "pointer",
                          fontWeight: 500,
                          marginTop: 8,
                        }}
                      >
                        {v.actionLabel}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", gap: 4, padding: "16px 20px 0" }}>
                  <div
                    onClick={() => setPvTab("diff")}
                    style={tabStyle(pvTab === "diff")}
                  >
                    版本 Diff
                  </div>
                  <div onClick={() => setPvTab("bind")} style={tabStyle(pvTab === "bind")}>
                    绑定 Agent
                  </div>
                </div>
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
                          <div onClick={ver.onPublishSel} style={{ ...btnPrimary, height: 34 }}>
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
                      <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden" }}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 130px 130px",
                            padding: "10px 16px",
                            background: "#fafafa",
                            borderBottom: "1px solid #f0f0f0",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "rgba(0,0,0,.6)",
                          }}
                        >
                          <div>Agent</div>
                          <div>Agent 版本</div>
                          <div>绑定 Prompt 版本</div>
                        </div>
                        {ver.bind.map((b, i) => (
                          <div
                            key={i}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 130px 130px",
                              padding: "11px 16px",
                              borderBottom: "1px solid #f0f0f0",
                              fontSize: 13,
                              alignItems: "center",
                            }}
                          >
                            <div style={{ fontWeight: 500 }}>{b.agent}</div>
                            <div style={{ ...mono, color: "rgba(0,0,0,.65)" }}>{b.av}</div>
                            <div>
                              <span
                                style={{
                                  fontSize: 12,
                                  ...mono,
                                  lineHeight: "20px",
                                  padding: "0 8px",
                                  borderRadius: 4,
                                  background: "#f6ffed",
                                  color: "#52c41a",
                                  border: "1px solid #b7eb8f",
                                }}
                              >
                                {b.pv}
                              </span>
                            </div>
                          </div>
                        ))}
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
