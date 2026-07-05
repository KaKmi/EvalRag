import { Global, Module } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { AppConfigService } from "../config/config.service";
import * as schema from "../../db/schema";
import { DRIZZLE } from "./drizzle.constants";

export type DB = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): DB => {
        const pool = new Pool({ connectionString: config.databaseUrl });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class PersistenceModule {}
