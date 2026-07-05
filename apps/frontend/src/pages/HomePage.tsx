import { useEffect, useState } from "react";
import { Card, Tag } from "antd";
import { getHealth } from "../api/client";

export function HomePage() {
  const [status, setStatus] = useState("...");
  useEffect(() => {
    getHealth()
      .then((h) => setStatus(`${h.status} · db:${h.db}`))
      .catch(() => setStatus("unreachable"));
  }, []);
  return (
    <Card title="快速开始（M0 骨架）">
      <p>
        后端健康：<Tag color="blue">{status}</Tag>
      </p>
    </Card>
  );
}
