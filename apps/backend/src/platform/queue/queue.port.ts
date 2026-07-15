export interface JobOptions {
  singletonKey?: string;
  retryLimit?: number;
}

export interface ScheduleOptions extends JobOptions {
  tz?: string;
  key?: string;
}

export interface Queue {
  publish(jobName: string, data: unknown, opts?: JobOptions): Promise<void>;
  subscribe(jobName: string, handler: (data: unknown) => Promise<void>): Promise<void>;
  schedule(jobName: string, cron: string, data: unknown, opts?: ScheduleOptions): Promise<void>;
}
