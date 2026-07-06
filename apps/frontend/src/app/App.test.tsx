import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

const NAV_LABELS = [
  "快速开始",
  "模型接入",
  "知识库",
  "Prompt 管理",
  "Agent 管理",
  "检索测试",
  "Trace 追踪",
];

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ status: "ok", db: "up" }),
  }) as unknown as typeof fetch;
});

it("redirects to /login when visiting /admin without a token", () => {
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <App />
    </MemoryRouter>,
  );
  // AuthGuard 无 token → Navigate /login → LoginPage 渲染
  expect(screen.getByText("登录（占位，M1 实现）")).toBeInTheDocument();
  // 管理后台 shell 不应渲染
  expect(screen.queryByText("CodeCrushBot")).not.toBeInTheDocument();
});

it("renders admin sider with brand and 7 nav items when authenticated", async () => {
  localStorage.setItem("token", "fake-token");
  // 用 /admin/dashboard（不在侧栏）避免页面标题与菜单文案重复匹配
  render(
    <MemoryRouter initialEntries={["/admin/dashboard"]}>
      <App />
    </MemoryRouter>,
  );
  // findByText 走 waitFor，在 act 内刷新 antd Menu/Layout 挂载后的异步状态更新
  expect(await screen.findByText("CodeCrushBot")).toBeInTheDocument();
  for (const label of NAV_LABELS) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

it("protects /chat behind AuthGuard", () => {
  render(
    <MemoryRouter initialEntries={["/chat"]}>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByText("登录（占位，M1 实现）")).toBeInTheDocument();
});
