import { Card } from "antd";

interface PagePlaceholderProps {
  title: string;
  milestone?: string;
}

/**
 * 通用占位页：M2 app shell 用它占住 14 条路由，
 * 后续 story（M3–M11）逐页替换为真实内容并改为 React.lazy 懒加载。
 */
export function PagePlaceholder({ title, milestone }: PagePlaceholderProps) {
  return (
    <Card title={`${title}（占位）`}>
      <p>
        {title} — 功能开发中{milestone ? `，见 ${milestone}` : ""}。
      </p>
    </Card>
  );
}
