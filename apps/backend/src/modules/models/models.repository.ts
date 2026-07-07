import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DRIZZLE } from "../../platform/persistence/drizzle.constants";
import type { DB } from "../../platform/persistence/persistence.module";
import { modelProviders, type ModelProviderRow, type NewModelProvider } from "./schema";

@Injectable()
export class ModelsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DB) {}

  async find(): Promise<ModelProviderRow[]> {
    return await this.db.select().from(modelProviders).orderBy(desc(modelProviders.createdAt));
  }

  async findById(id: string): Promise<ModelProviderRow | undefined> {
    const rows = await this.db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.id, id))
      .limit(1);
    return rows[0];
  }

  async insert(row: NewModelProvider): Promise<ModelProviderRow> {
    const rows = await this.db.insert(modelProviders).values(row).returning();
    return rows[0];
  }

  async update(id: string, patch: Partial<NewModelProvider>): Promise<ModelProviderRow | undefined> {
    const rows = await this.db
      .update(modelProviders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(modelProviders.id, id))
      .returning();
    return rows[0];
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(modelProviders).where(eq(modelProviders.id, id));
  }
}
