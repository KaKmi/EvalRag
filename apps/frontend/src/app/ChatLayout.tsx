import { Layout } from "antd";

const { Sider, Content } = Layout;

/**
 * C 端问答 shell：三栏（会话列表 + 聊天 + 引用面板）。
 * M2 只建空壳，Story 5 填 mock 会话/消息/引用，M8 接真实 SSE 流。
 */
export function ChatLayout() {
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={260} theme="light">
        <div style={{ padding: 16, fontWeight: 600 }}>会话列表</div>
      </Sider>
      <Content style={{ padding: 16 }}>
        <div style={{ fontWeight: 600 }}>聊天</div>
      </Content>
      <Sider width={360} theme="light">
        <div style={{ padding: 16, fontWeight: 600 }}>引用</div>
      </Sider>
    </Layout>
  );
}
