import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import type { Prompt, PromptNode } from "@codecrush/contracts";
import { createPrompt, deletePrompt, getPrompts } from "../../api/client";
import { NODE_LABEL, NODE_META } from "../../mocks/prompts";

/**
 * Prompt 列表页（012 重构）：版本平权——列展示最新版本/标识（标签）/变量，
 * 不再有发布状态列与发布/回滚入口；点行进入路由式详情 `/admin/prompts/:id`。
 */

const NODE_TAG_COLOR: Record<PromptNode, string> = {
  rewrite: "blue",
  intent: "purple",
  reply: "green",
  fallback: "gold",
};

const mono: CSSProperties = { fontFamily: "ui-monospace, Menlo, monospace" };

/** ISO datetime → "MM-DD HH:mm"（本地时区，对齐原型展示）。 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** production 用强调色（绿色），其余自定义标签中性色（012 §3：只是强调色标签，无上线语义） */
export function tagColor(name: string): string | undefined {
  return name === "production" ? "green" : undefined;
}

export default function PromptsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterNode, setFilterNode] = useState<PromptNode | "all">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // 新建弹窗：只填名称 + 节点（012：v1 空 body 服务端生成，成功后跳详情）
  const [createOpen, setCreateOpen] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ name: string; node: PromptNode }>();
  const watchedNode = Form.useWatch("node", form);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setListErr("");
    try {
      const res = await getPrompts({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        node: filterNode === "all" ? undefined : filterNode,
      });
      setRows(res.items);
      setTotal(res.total);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch, filterNode]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // 搜索输入 debounce 300ms + 回第 1 页
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const submitCreate = async () => {
    let values: { name: string; node: PromptNode };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setCreating(true);
    setCreateErr("");
    try {
      const detail = await createPrompt({ name: values.name.trim(), node: values.node });
      setCreateOpen(false);
      navigate(`/admin/prompts/${detail.id}`);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const deletePromptById = async (promptId: string) => {
    setDeletingId(promptId);
    setListErr("");
    try {
      await deletePrompt(promptId);
      await refreshList();
    } catch (e) {
      // FK 409：被应用配置引用不可删
      setListErr(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  const hasFilter = search !== "" || filterNode !== "all";
  const resetFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setFilterNode("all");
    setPage(1);
  };

  const columns: TableColumnsType<Prompt> = [
    {
      title: "Prompt 名称",
      dataIndex: "name",
      key: "name",
      width: 220,
      render: (name: string) => <span style={{ fontWeight: 500 }}>{name}</span>,
    },
    {
      title: "所属节点",
      dataIndex: "node",
      key: "node",
      width: 110,
      render: (_: unknown, r: Prompt) => (
        <Tag color={NODE_TAG_COLOR[r.node]}>{NODE_LABEL[r.node]}</Tag>
      ),
    },
    {
      title: "最新版本",
      key: "latestVersion",
      width: 100,
      render: (_: unknown, r: Prompt) => (
        <span style={mono}>
          v{r.latestVersion}
          {r.versionCount > 1 && (
            <span style={{ color: "rgba(0,0,0,.35)", fontSize: 12 }}> / {r.versionCount} 版</span>
          )}
        </span>
      ),
    },
    {
      title: "标识",
      key: "tags",
      width: 160,
      render: (_: unknown, r: Prompt) =>
        r.tags.length > 0 ? (
          <Space size={4} wrap>
            {r.tags.map((t) => (
              <Tag key={t} color={tagColor(t)} style={mono}>
                {t}
              </Tag>
            ))}
          </Space>
        ) : (
          <span style={{ color: "rgba(0,0,0,.35)" }}>—</span>
        ),
    },
    {
      title: "变量",
      key: "variables",
      width: 200,
      render: (_: unknown, r: Prompt) =>
        r.variables.length > 0 ? (
          <Space size={4} wrap>
            {r.variables.map((v) => (
              <Tag key={v} style={{ ...mono, fontSize: 12 }}>{`{${v}}`}</Tag>
            ))}
          </Space>
        ) : (
          <span style={{ color: "rgba(0,0,0,.35)" }}>—</span>
        ),
    },
    {
      title: "更新人 · 时间",
      key: "updated",
      width: 200,
      render: (_: unknown, r: Prompt) => (
        <span style={{ color: "rgba(0,0,0,.65)" }}>
          {r.updatedBy} · {formatDateTime(r.updatedAt)}
        </span>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      render: (_: unknown, r: Prompt) => (
        <Space size="small" onClick={(e) => e.stopPropagation()}>
          <Button type="link" size="small" onClick={() => navigate(`/admin/prompts/${r.id}`)}>
            打开
          </Button>
          <Popconfirm
            title="确认删除该 Prompt？全部版本与标签将一并删除。"
            description="被应用配置引用的 Prompt 无法删除。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => deletePromptById(r.id)}
          >
            <Button type="link" size="small" danger loading={deletingId === r.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600 }}>Prompt 管理</div>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          ＋ 新建 Prompt
        </Button>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="搜索名称或更新人"
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 240 }}
        />
        <Select<PromptNode | "all">
          value={filterNode}
          onChange={(v) => {
            setFilterNode(v);
            setPage(1);
          }}
          style={{ width: 140 }}
          options={[
            { value: "all" as const, label: "全部节点" },
            ...(Object.keys(NODE_LABEL) as PromptNode[]).map((n) => ({
              value: n,
              label: NODE_LABEL[n],
            })),
          ]}
        />
        {hasFilter && <Button onClick={resetFilters}>重置</Button>}
      </Space>

      {listErr && (
        <Alert
          type="error"
          message={listErr}
          showIcon
          closable
          onClose={() => setListErr("")}
          style={{ marginBottom: 12 }}
        />
      )}

      <Table<Prompt>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        onRow={(r) => ({
          onClick: () => navigate(`/admin/prompts/${r.id}`),
          style: { cursor: "pointer" },
        })}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        size="middle"
        locale={{
          emptyText: hasFilter ? "无匹配的 Prompt" : "暂无 Prompt，点击右上角「新建 Prompt」创建",
        }}
      />

      <Modal
        open={createOpen}
        title="新建 Prompt"
        okText="创建并打开"
        cancelText="取消"
        confirmLoading={creating}
        onOk={() => void submitCreate()}
        onCancel={() => {
          setCreateOpen(false);
          setCreateErr("");
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ node: "reply" }}>
          <Form.Item
            name="name"
            label="Prompt 名称"
            rules={[{ required: true, whitespace: true, message: "请填写 Prompt 名称" }]}
          >
            <Input placeholder="如：售后回复生成" />
          </Form.Item>
          <Form.Item name="node" label="所属节点" rules={[{ required: true }]}>
            <Radio.Group
              options={(Object.keys(NODE_LABEL) as PromptNode[]).map((n) => ({
                value: n,
                label: NODE_LABEL[n],
              }))}
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)", lineHeight: 1.6 }}>
            {NODE_META[watchedNode ?? "reply"]?.hint}
          </div>
          {createErr && (
            <div style={{ marginTop: 8, fontSize: 13, color: "#ff4d4f" }}>{createErr}</div>
          )}
        </Form>
      </Modal>
    </div>
  );
}
