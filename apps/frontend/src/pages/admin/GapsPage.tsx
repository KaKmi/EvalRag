/**
 * 知识缺口（数据飞轮）：M10/M11 功能，本页为布局壳 + 空态。
 * 完整 1:1 原型还原（缺口列表/聚类/一键补充知识）归入 M10 设计波。
 */
export default function GapsPage() {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>知识缺口</div>
      <div style={{ fontSize: 13, color: "rgba(0,0,0,.45)", margin: "8px 0 16px" }}>
        从兜底/低置信度回答中发现知识库未覆盖的问题，沉淀为待补充知识。
      </div>
      <div
        style={{
          background: "#fff",
          border: "1px solid #f0f0f0",
          borderRadius: 8,
          padding: 48,
          textAlign: "center",
          fontSize: 13,
          color: "rgba(0,0,0,.45)",
        }}
      >
        暂无知识缺口数据——问答链路（M8）上线后自动归集。
      </div>
    </div>
  );
}
