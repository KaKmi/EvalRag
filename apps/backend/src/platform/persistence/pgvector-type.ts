import { customType } from "drizzle-orm/pg-core";

/**
 * pgvector 列类型（Postgres 扩展已由 infra/postgres/init.sql 在容器初始化时启用，
 * 见 007 Design）。drizzle-orm 无内置 vector 类型，手写 customType：
 * DDL 声明 vector(1024)（平台统一维度，见 Global Constraints）；
 * 写入序列化为 pgvector 文本字面量 `[0.1,0.2,...]`；读出反解析回 number[]。
 */
/**
 * 平台统一的向量维度。**列类型与任何维度校验都必须引用它**，别再各处写字面量 1024——
 * 校验和列一旦对不上，插入时才由 pgvector 抛原始错误（冒成 500）。
 */
export const VECTOR_DIMENSION = 1024;

export const vector1024 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${VECTOR_DIMENSION})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});
