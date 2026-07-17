import { Logger } from "@nestjs/common";
import type { JobOptions, Queue, ScheduleOptions } from "./queue.port";

/**
 * 消费门控包装器（019 D1）：subscribe/schedule 在本进程角色不消费该队列时 no-op
 * （各记一条 log），publish 恒透传（019 Boundary 3——worker 的 lease_busy 重投、
 * API 的发起 run 都要能入队）。门控落在 Queue 实例层而非 processor——processor
 * 拿到的 Queue 本身已按角色裁剪，绕不过去也无需感知（Boundary 1「processor
 * 不得自带角色判断逻辑」的落点）。
 */
export class RoleGatedQueueAdapter implements Queue {
  constructor(
    private readonly inner: Queue,
    private readonly consumeEnabled: boolean,
    private readonly label: string,
    private readonly logger: Pick<Logger, "log"> = new Logger(RoleGatedQueueAdapter.name),
  ) {}

  async publish(jobName: string, data: unknown, opts?: JobOptions): Promise<void> {
    return this.inner.publish(jobName, data, opts);
  }

  async subscribe(jobName: string, handler: (data: unknown) => Promise<void>): Promise<void> {
    if (!this.consumeEnabled) {
      this.logger.log(`跳过 ${this.label} 消费者注册（${jobName}）：本进程角色不消费该队列`);
      return;
    }
    return this.inner.subscribe(jobName, handler);
  }

  async schedule(
    jobName: string,
    cron: string,
    data: unknown,
    opts?: ScheduleOptions,
  ): Promise<void> {
    if (!this.consumeEnabled) {
      this.logger.log(`跳过 ${this.label} 周期注册（${jobName}）：本进程角色不消费该队列`);
      return;
    }
    return this.inner.schedule(jobName, cron, data, opts);
  }
}
