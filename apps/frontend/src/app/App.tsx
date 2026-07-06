import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { AuthGuard } from "./AuthGuard";
import { ChatLayout } from "./ChatLayout";
import { PagePlaceholder } from "../components/PagePlaceholder";
import { LoginPage } from "../pages/LoginPage";

/**
 * 路由根：14 条 admin 路由（覆盖 15 屏）+ /login + /chat + 通配重定向。
 * 路由表对齐 docs/design/006-m2-app-shell-skeleton.md。
 * M2 admin 子路由暂用 PagePlaceholder 占位，Story 5 起逐页替换为 React.lazy 真实页面。
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/chat"
        element={
          <AuthGuard>
            <ChatLayout />
          </AuthGuard>
        }
      />
      <Route
        path="/admin"
        element={
          <AuthGuard>
            <AdminLayout />
          </AuthGuard>
        }
      >
        <Route index element={<PagePlaceholder title="快速开始" milestone="M2" />} />
        <Route path="dashboard" element={<PagePlaceholder title="运行看板" milestone="M10" />} />
        <Route path="agents" element={<PagePlaceholder title="Agent 管理" milestone="M7" />} />
        <Route
          path="knowledge-bases"
          element={<PagePlaceholder title="知识库管理" milestone="M4" />}
        />
        <Route
          path="knowledge-bases/:kbId/documents"
          element={<PagePlaceholder title="知识库文档" milestone="M4" />}
        />
        <Route
          path="knowledge-bases/:kbId/documents/:docId/chunks"
          element={<PagePlaceholder title="文档切片" milestone="M4" />}
        />
        <Route path="retrieval-test" element={<PagePlaceholder title="检索测试" milestone="M5" />} />
        <Route path="prompts" element={<PagePlaceholder title="Prompt 管理" milestone="M6" />} />
        <Route path="evalsets" element={<PagePlaceholder title="评测集" milestone="M11" />} />
        <Route path="evaluations" element={<PagePlaceholder title="评测运行" milestone="M11" />} />
        <Route
          path="evaluations/:reportId"
          element={<PagePlaceholder title="评测报告" milestone="M11" />}
        />
        <Route path="traces" element={<PagePlaceholder title="Trace 追踪" milestone="M9" />} />
        <Route path="traces/:traceId" element={<PagePlaceholder title="Trace 详情" milestone="M9" />} />
        <Route path="models" element={<PagePlaceholder title="模型调用管理" milestone="M3" />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
