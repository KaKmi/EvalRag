import { Layout, Menu } from "antd";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { HomePage } from "../pages/HomePage";
import { LoginPage } from "../pages/LoginPage";

const { Header, Sider, Content } = Layout;

export function App() {
  const loc = useLocation();
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="light">
        <div style={{ padding: 16, fontWeight: 600 }}>CodeCrushBot</div>
        <Menu
          mode="inline"
          selectedKeys={[loc.pathname]}
          items={[
            { key: "/", label: <Link to="/">控制台</Link> },
            { key: "/login", label: <Link to="/login">登录</Link> },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ background: "#fff" }}>管理后台</Header>
        <Content style={{ margin: 16 }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
