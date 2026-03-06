import pg from "pg"
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"

const { Pool } = pg

/**
 * V2 LangGraph Checkpointer for Email Repo
 *
 * Connects to v2_ai_schema in the shared Supabase Postgres database.
 * Tables are pre-provisioned in dreamplay-knowledge (migration 20260306_03),
 * so setup() is NOT called.
 *
 * This is the same shared database as dreamplay-knowledge.
 */

let _pool: pg.Pool | null = null

function getPool(): pg.Pool {
    if (!_pool) {
        const connString = process.env.SUPABASE_DB_URL
        if (!connString) {
            throw new Error("SUPABASE_DB_URL is not set. Required for LangGraph checkpointer.")
        }
        _pool = new Pool({ connectionString: connString })
    }
    return _pool
}

/**
 * Get a PostgresSaver instance configured for v2_ai_schema.
 * IMPORTANT: Do NOT call .setup() — tables are pre-provisioned.
 */
export function getCheckpointer(): PostgresSaver {
    const pool = getPool()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg Pool version mismatch workaround
    return new PostgresSaver(pool as any, undefined, { schema: "v2_ai_schema" })
}
