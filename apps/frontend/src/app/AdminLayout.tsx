import { Button, Layout, Menu } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

const { Header, Sider, Content } = Layout;

/** 侧栏 7 项导航（对齐原型 NAV：start/llm/kb/prompts/agents/retrieval/traces） */
const NAV_ITEMS = [
  { key: "/admin", label: "快速开始" },
  { key: "/admin/models", label: "模型接入" },
  { key: "/admin/knowledge-bases", label: "知识库" },
  { key: "/admin/prompts", label: "Prompt 管理" },
  { key: "/admin/agents", label: "Agent 管理" },
  { key: "/admin/retrieval-test", label: "检索测试" },
  { key: "/admin/traces", label: "Trace 追踪" },
] as const;

/** 子路由需要高亮父级菜单的路径前缀（dashboard/evalsets/evaluations 不在侧栏） */
const PREFIX_KEYS = [
  "/admin/models",
  "/admin/knowledge-bases",
  "/admin/prompts",
  "/admin/agents",
  "/admin/retrieval-test",
  "/admin/traces",
];

function getSelectedKey(pathname: string): string {
  if (pathname === "/admin") return "/admin";
  return PREFIX_KEYS.find((k) => pathname === k || pathname.startsWith(`${k}/`)) ?? "";
}

export function AdminLayout() {
  const loc = useLocation();
  const navigate = useNavigate();
  const selectedKey = getSelectedKey(loc.pathname);

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login", { replace: true });
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="dark" width={220} style={{ overflow: "auto" }}>
        <div
          style={{
            padding: 16,
            color: "#fff",
            fontWeight: 600,
            fontSize: 18,
            whiteSpace: "nowrap",
          }}
        >
          CodeCrushBot
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          items={NAV_ITEMS.map((item) => ({
            key: item.key,
            label: <Link to={item.key}>{item.label}</Link>,
          }))}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 600 }}>管理后台</span>
          <Button onClick={handleLogout}>退出</Button>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
