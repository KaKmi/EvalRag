import { Controller, Get, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { HealthResponse } from "@codecrush/contracts";
import { DRIZZLE } from "../../platform/persistence/drizzle.constants";
import type { DB } from "../../platform/persistence/persistence.module";
import { Public } from "../../platform/security/public.decorator";

@Public()
@Controller("health")
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: DB) {}

  @Get()
  async check(): Promise<HealthResponse> {
    let db: "up" | "down" = "up";
    try {
      await this.db.execute(sql`SELECT 1`);
    } catch {
      db = "down";
    }
    return { status: db === "up" ? "ok" : "error", db, details: { db: { status: db } } };
  }
}
