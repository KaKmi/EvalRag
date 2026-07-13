import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { message, Spin } from "antd";
import type { SessionDetailResponse, TraceStatus } from "@codecrush/contracts";
import { getSession } from "../../api/client";

/**
 * M9 W3：Session 详情——1:1 还原 C 端聊天窗口（该会话在用户侧的真实呈现），
 * 每条回复气泡下方挂 Trace 溯源条，点击下钻到该轮调用链路（原型「Session 详情」屏）。
 */

const AGENT_COLOR = "#1677ff"; // 同 C 端 ChatPage：原型无真实每 Agent 颜色字段，固定主题色
const initialOf = (name: string): string => name.trim().slice(0, 1).toUpperCase() || "A";

const STATUS_TAG: Record<TraceStatus, { label: string; bg: string; c: string; bd: string }> = {
  success: { label: "成功", bg: "#f6ffed", c: "#52c41a", bd: "#b7eb8f" },
  fallback: { label: "兜底", bg: "#fffbe6", c: "#d48806", bd: "#ffe58f" },
  failed: { label: "失败", bg: "#fff2f0", c: "#ff4d4f", bd: "#ffccc7" },
};

const fmtMs = (ms: number): string => (ms >= 1000 ? (ms / 1000).toFixed(2) + "s" : Math.round(ms) + "ms");
const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
};
const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
};

export default function SessionDetailPage() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const nav = useNavigate();
  const [data, setData] = useState<SessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getSession(sessionId)
      .then((r) => {
        if (live) setData(r);
      })
      .catch((e: unknown) => {
        if (live) message.error(e instanceof Error ? e.message : "加载会话详情失败");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [sessionId]);

  const headBtn: CSSProperties = {
    height: 30,
    padding: "0 12px",
    border: "1px solid #d9d9d9",
    borderRadius: 6,
    background: "#fff",
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    cursor: "pointer",
    width: "fit-content",
  };

  const firstTs = useMemo(() => data?.rounds[0]?.startTime ?? "", [data]);

  if (loading) {
    return (
      <div style={{ padding: 64, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }
  if (!data || data.rounds.length === 0) {
    return (
      <div>
        <div onClick={() => nav("/admin/traces")} style={{ ...headBtn, marginBottom: 16 }}>
          ← 返回列表
        </div>
        <div style={{ padding: 48, textAlign: "center", color: "rgba(0,0,0,.3)", fontSize: 13 }}>
          未找到该会话（可能尚未落库或已过期）
        </div>
      </div>
    );
  }

  const initial = initialOf(data.agentName || "A");

  return (
    <div>
      {/* 头部：返回 + sessionId + 用户/轮次 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div onClick={() => nav("/admin/traces")} style={headBtn}>
          ← 返回列表
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "ui-monospace,Menlo,monospace" }}>{data.sessionId}</div>
        <span style={{ fontSize: 12, color: "rgba(0,0,0,.45)" }}>
          用户 {data.userId ?? "—"} · {data.rounds.length} 轮
        </span>
      </div>

      {/* C 端聊天窗口卡 */}
      <div style={{ maxWidth: 520, margin: "0 auto", border: "1px solid #ebebeb", borderRadius: 14, overflow: "hidden", boxShadow: "0 6px 24px rgba(0,0,0,.06)", background: "#f5f6f8" }}>
        {/* 顶栏 */}
        <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 10, padding: "0 16px" }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: AGENT_COLOR, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600 }}>{initial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.agentName || "—"}</div>
            <div style={{ fontSize: 11, color: "#52c41a", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#52c41a" }} />
              在线
            </div>
          </div>
          <div style={{ fontSize: 11, color: "rgba(0,0,0,.3)" }}>AI 客服</div>
        </div>

        {/* 气泡区 */}
        <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: 16, maxHeight: 560, overflowY: "auto" }}>
          {firstTs && (
            <div style={{ textAlign: "center" }}>
              <span style={{ fontSize: 11, color: "rgba(0,0,0,.35)", background: "rgba(0,0,0,.05)", padding: "2px 10px", borderRadius: 10 }}>{fmtDate(firstTs)}</span>
            </div>
          )}
          {data.rounds.map((t) => {
            const st = STATUS_TAG[t.status];
            const time = fmtTime(t.startTime);
            return (
              <div key={t.traceId} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* 用户气泡（右） */}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "flex-start" }}>
                  <div style={{ maxWidth: "74%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                    <div style={{ background: "#95ec69", color: "#1a1a1a", padding: "9px 13px", borderRadius: 8, fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.userInput || "—"}</div>
                    <span style={{ fontSize: 10, color: "rgba(0,0,0,.3)" }}>{time}</span>
                  </div>
                  <div style={{ width: 32, height: 32, flex: "none", borderRadius: 8, background: "#c9ced6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>👤</div>
                </div>

                {/* Bot 气泡（左）+ Trace 溯源条 */}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-start", alignItems: "flex-start" }}>
                  <div style={{ width: 32, height: 32, flex: "none", borderRadius: 8, background: AGENT_COLOR, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600 }}>{initial}</div>
                  <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                    <div style={{ background: "#fff", color: "#1a1a1a", padding: "10px 14px", borderRadius: 8, fontSize: 13.5, lineHeight: 1.7, boxShadow: "0 1px 2px rgba(0,0,0,.04)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.output || "—"}</div>
                    {/* 溯源条：观测层，点击下钻到该轮 Trace 详情 */}
                    <div
                      onClick={() => nav(`/admin/traces/${t.traceId}`)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(22,119,255,.06)", border: "1px solid rgba(22,119,255,.15)", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}
                    >
                      <span style={{ fontSize: 10, lineHeight: "16px", padding: "0 6px", borderRadius: 3, background: st.bg, color: st.c, border: `1px solid ${st.bd}` }}>{st.label}</span>
                      <span style={{ fontSize: 10.5, fontFamily: "ui-monospace,Menlo,monospace", color: "#1677ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>{t.traceId}</span>
                      <span style={{ fontSize: 10.5, color: "rgba(0,0,0,.4)" }}>{fmtMs(t.durationMs)}</span>
                      <span style={{ fontSize: 10.5, color: "#1677ff", flex: "none" }}>链路 →</span>
                    </div>
                    <span style={{ fontSize: 10, color: "rgba(0,0,0,.3)" }}>{time}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 输入栏（装饰，还原 C 端观感） */}
        <div style={{ height: 52, background: "#fff", borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 10, padding: "0 14px" }}>
          <div style={{ flex: 1, height: 34, background: "#f5f6f8", borderRadius: 8, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 13, color: "rgba(0,0,0,.3)" }}>输入消息…</div>
          <div style={{ width: 60, height: 32, borderRadius: 7, background: "#e6e8eb", color: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>发送</div>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: 11, color: "rgba(0,0,0,.35)", marginTop: 12 }}>
        这是该会话在 C 端的真实呈现 · 每条回复下方的溯源条点击可下钻到 Trace 调用链路
      </div>
    </div>
  );
}
