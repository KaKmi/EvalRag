import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Drawer, Empty, Input, Space, Spin, Tag, Tooltip, message } from "antd";
import {
  compilePromptBody,
  NODE_CONTRACTS,
  type CompileIssue,
  type PromptDetail,
  type PromptVersion,
} from "@codecrush/contracts";
import { createPromptVersion, getPromptDetail } from "../../api/client";
import { NODE_LABEL, NODE_META } from "../../mocks/prompts";
import { formatDateTime, tagColor } from "./PromptsPage";

/**
 * Prompt 详情 · Playground（012 §2，对齐 Prompt详情·Playground.dc.html）：
 * 左栏编辑（节点说明 / 正文 / 实时编译红黄线 / 可插入字段 chips / 保存为新版本），
 * 右栏试运行（Story 7 接真实 try-run），历史版本抽屉按需展开。
 * 「谁在用」徽标/服务中条幅依赖 applications usage API（009），不可用时静默省略——
 * 不把未知显示成"无人使用"。
 */

const NODE_TAG_COLOR: Record<string, string> = {
  rewrite: "blue",
  intent: "purple",
  reply: "green",
  fallback: "gold",
};

const mono: CSSProperties = { fontFamily: "ui-monospace, Menlo, monospace" };

export default function PromptDetailPage() {
  const { promptId = "" } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  // 编辑态：载入的来源版本 + 正文 + 版本说明
  const [sourceVersion, setSourceVersion] = useState<PromptVersion | null>(null);
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);

  const refresh = useCallback(
    async (loadLatestIntoEditor: boolean) => {
      setLoadErr("");
      try {
        const d = await getPromptDetail(promptId);
        setDetail(d);
        if (loadLatestIntoEditor && d.versions.length > 0) {
          setSourceVersion(d.versions[0]);
          setBody(d.versions[0].body);
          setNote("");
        }
        return d;
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : "加载失败");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [promptId],
  );

  useEffect(() => {
    setLoading(true);
    void refresh(true);
  }, [refresh]);

  const node = detail?.node;
  const contract = node ? NODE_CONTRACTS[node] : null;
  // 实时编译来自 contracts 纯函数（前后端同一实现）；服务端保存结果是最终事实
  const compiled = useMemo(
    () => (node ? compilePromptBody(body, node) : { status: "ok" as const, issues: [] }),
    [body, node],
  );
  const errors = compiled.issues.filter((i) => i.severity === "error");
  const warnings = compiled.issues.filter((i) => i.severity === "warning");
  const dirty = sourceVersion !== null && body !== sourceVersion.body;

  const applySuggestion = (issue: CompileIssue) => {
    if (!issue.field || !issue.suggestion) return;
    setBody((prev) => prev.split(`{${issue.field}}`).join(`{${issue.suggestion}}`));
  };

  const insertField = (field: string) => {
    setBody((prev) => (prev ? prev + (/\s$/.test(prev) ? "" : " ") + `{${field}}` : `{${field}}`));
  };

  const loadVersion = (v: PromptVersion, opts?: { copyNote?: boolean }) => {
    setSourceVersion(v);
    setBody(v.body);
    setNote(opts?.copyNote ? `基于 v${v.version} 修改` : "");
    setSaveErr("");
    setHistoryOpen(false);
  };

  const save = async () => {
    if (!detail || !sourceVersion) return;
    if (!body.trim()) {
      // 空 body 允许保存（012），但提示确认语义由按钮文案承担；此处仅提示
      message.warning("正文为空——仍会保存为新版本");
    }
    setSaving(true);
    setSaveErr("");
    try {
      const created = await createPromptVersion(detail.id, {
        body,
        note: note.trim() || undefined,
        sourceVersionId: sourceVersion.id,
      });
      message.success(`已保存为 v${created.version}`);
      const d = await refresh(false);
      // 保存后切换到新版本继续编辑
      const latest = d?.versions.find((v) => v.id === created.id) ?? created;
      setSourceVersion(latest);
      setBody(latest.body);
      setNote("");
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }
  if (!detail || !node || !contract) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" showIcon message={loadErr || "Prompt 不存在"} />
        <Button style={{ marginTop: 16 }} onClick={() => navigate("/admin/prompts")}>
          返回列表
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* 头部：返回 / 名称 / 节点 / 历史版本按钮 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Button size="small" onClick={() => navigate("/admin/prompts")}>
          ← 返回
        </Button>
        <span style={{ fontSize: 12, color: "rgba(0,0,0,.45)" }}>Prompt 管理 /</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{detail.name}</span>
        <Tag color={NODE_TAG_COLOR[node]}>{NODE_LABEL[node]}</Tag>
        <div style={{ flex: 1 }} />
        <Button onClick={() => setHistoryOpen(true)}>🕑 历史版本 {detail.versionCount}</Button>
      </div>

      {loadErr && (
        <Alert type="error" showIcon closable message={loadErr} style={{ marginBottom: 12 }} />
      )}

      {/* flexWrap：窄视口时右栏换行到下方，避免左栏被固定宽右栏挤压 */}
      <div style={{ display: "flex", gap: 16, alignItems: "stretch", flexWrap: "wrap" }}>
        {/* 左栏 · 编辑区 */}
        <div
          style={{
            flex: 1,
            minWidth: 420,
            background: "#fff",
            border: "1px solid #f0f0f0",
            borderRadius: 8,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              background: "#fafafa",
              border: "1px solid #f0f0f0",
              borderRadius: 6,
              padding: "10px 14px",
            }}
          >
            <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)", marginBottom: 4 }}>
              这个节点是做什么的
            </div>
            <div style={{ fontSize: 13, color: "rgba(0,0,0,.65)", lineHeight: 1.7 }}>
              {NODE_META[node].hint}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>你希望它怎么做</span>
              <span style={{ fontSize: 12, color: "rgba(0,0,0,.45)", ...mono }}>
                编辑中 v{sourceVersion?.version}
                {dirty ? " · 有未保存修改" : ""}
              </span>
            </div>
            <Input.TextArea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setSaveErr("");
              }}
              placeholder="用大白话写清楚这一节点该怎么做…"
              autoSize={{ minRows: 12, maxRows: 22 }}
              style={{ ...mono, fontSize: 13, lineHeight: 1.8 }}
            />
            {/* 编译错误（红）/ 警告（黄）——contracts 纯函数实时计算 */}
            {errors.map((i, idx) => (
              <div key={`e${idx}`} style={{ fontSize: 12, color: "#ff4d4f", lineHeight: 1.6 }}>
                ✕ {i.message}
                {i.suggestion && (
                  <Button
                    type="link"
                    size="small"
                    style={{ fontSize: 12, padding: "0 4px" }}
                    onClick={() => applySuggestion(i)}
                  >
                    一键改为 {`{${i.suggestion}}`}
                  </Button>
                )}
              </div>
            ))}
            {warnings.map((i, idx) => (
              <div key={`w${idx}`} style={{ fontSize: 12, color: "#d48806", lineHeight: 1.6 }}>
                ⚠ {i.message}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              可以用到的信息{" "}
              <span style={{ fontSize: 12, color: "rgba(0,0,0,.45)", fontWeight: 400 }}>
                · 点一下插入
              </span>
            </div>
            <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)", lineHeight: 1.6 }}>
              这些信息由系统固定提供，不需要你配置。插入只是把标记放进策略里，方便指向该参考哪块信息——不插入也一样会正常提供给它。
            </div>
            <Space size={6} wrap>
              {contract.templateFields.map((f) => (
                <Tag
                  key={f}
                  color="blue"
                  style={{ cursor: "pointer", userSelect: "none", ...mono }}
                  onClick={() => insertField(f)}
                >
                  + {`{${f}}`}
                </Tag>
              ))}
            </Space>
          </div>

          <div
            style={{
              borderTop: "1px solid #f0f0f0",
              paddingTop: 14,
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="版本说明（可选）：记录本次修改，便于回溯"
              style={{ flex: 1 }}
            />
            <Button type="primary" loading={saving} onClick={() => void save()}>
              保存为新版本
            </Button>
          </div>
          {saveErr && <div style={{ fontSize: 13, color: "#ff4d4f" }}>{saveErr}</div>}
        </div>

        {/* 右栏 · 试运行区（Story 7 接真实 try-run；未接入前不展示可运行状态） */}
        <div
          data-testid="try-run-panel"
          style={{
            width: 380,
            flex: "none",
            background: "#fff",
            border: "1px solid #f0f0f0",
            borderRadius: 8,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            试运行{" "}
            <span style={{ fontSize: 12, color: "rgba(0,0,0,.45)", fontWeight: 400 }}>
              · 只跑这一个节点
            </span>
          </div>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ fontSize: 12, color: "rgba(0,0,0,.45)" }}>
                试运行能力接入中（保存的版本可随时回来试）
              </span>
            }
            style={{ margin: "48px 0" }}
          />
        </div>
      </div>

      {/* 历史版本抽屉：点行载入编辑；「创建副本」预填说明 */}
      <Drawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        size={420}
        title={`历史版本 · ${detail.versionCount}`}
      >
        <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)", marginBottom: 12, lineHeight: 1.6 }}>
          点一行载入编辑（改完保存生成新版本，不动原版本）。
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {detail.versions.map((v) => {
            const isEditing = sourceVersion?.id === v.id;
            return (
              <div
                key={v.id}
                data-testid={`history-version-${v.version}`}
                onClick={() => loadVersion(v)}
                style={{
                  border: `1px solid ${isEditing ? "#1677ff" : "#f0f0f0"}`,
                  background: isEditing ? "#e6f4ff" : "#fff",
                  borderRadius: 8,
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, ...mono }}>v{v.version}</span>
                  {v.tags.map((t) => (
                    <Tag key={t} color={tagColor(t)} style={{ ...mono, fontSize: 11 }}>
                      {t}
                    </Tag>
                  ))}
                  {v.compileStatus === "has_errors" && (
                    <Tooltip title="该版本保存时存在编译错误">
                      <Tag color="red" style={{ fontSize: 11 }}>
                        编译错误
                      </Tag>
                    </Tooltip>
                  )}
                  {isEditing && (
                    <span style={{ fontSize: 11, color: "#1677ff" }}>编辑中</span>
                  )}
                  <div style={{ flex: 1 }} />
                  <Button
                    type="link"
                    size="small"
                    style={{ fontSize: 12 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      loadVersion(v, { copyNote: true });
                    }}
                  >
                    创建副本
                  </Button>
                </div>
                <div style={{ fontSize: 12, color: "rgba(0,0,0,.6)", marginBottom: 4 }}>
                  {v.note || "（无说明）"}
                </div>
                <div style={{ fontSize: 11, color: "rgba(0,0,0,.35)" }}>
                  {v.author} · {formatDateTime(v.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      </Drawer>
    </div>
  );
}
