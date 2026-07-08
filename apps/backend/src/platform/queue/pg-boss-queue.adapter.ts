import { Injectable } from "@nestjs/common";
// pg-boss v12 是纯 ESM 包且不带 default export（仅 named export `PgBoss`）——
// 实测 `import PgBoss from "pg-boss"` 在本仓库 CommonJS 编译下会拿到 undefined，
// 故此处用 named type-only import，偏离 brief 里的默认导入写法。
import type { PgBoss } from "pg-boss";
import type { JobOptions, Queue } from "./queue.port";

@Injectable()
export class PgBossQueueAdapter implements Queue {
  constructor(private readonly boss: PgBoss) {}

  async publish(jobName: string, data: unknown, opts: JobOptions = {}): Promise<void> {
    await this.boss.send(jobName, data as object, {
      singletonKey: opts.singletonKey,
      retryLimit: opts.retryLimit ?? 0,
    });
  }

  async subscribe(jobName: string, handler: (data: unknown) => Promise<void>): Promise<void> {
    await this.boss.work(jobName, async (jobs: Array<{ data: unknown }>) => {
      for (const job of jobs) {
        await handler(job.data);
      }
    });
  }
}
