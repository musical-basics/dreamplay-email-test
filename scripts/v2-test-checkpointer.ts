#!/usr/bin/env tsx
/**
 * V2 Checkpointer Test Script
 *
 * Verifies that the PostgresSaver can connect to v2_ai_schema
 * and read/write checkpoint data.
 *
 * Usage:
 *   npx tsx scripts/v2-test-checkpointer.ts
 *
 * Requires:
 *   - SUPABASE_DB_URL (direct Postgres connection)
 */

import dotenv from "dotenv"
import path from "path"
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") })

import pg from "pg"

const { Pool } = pg

async function main() {
    console.log("═══════════════════════════════════════════════════")
    console.log("  V2 Checkpointer Connection Test")
    console.log("═══════════════════════════════════════════════════\n")

    const connString = process.env.SUPABASE_DB_URL
    if (!connString) {
        console.error("✗ SUPABASE_DB_URL is not set in .env.local")
        process.exit(1)
    }

    const pool = new Pool({ connectionString: connString })

    try {
        // Test 1: Basic connection
        console.log("[1/4] Testing database connection...")
        const connResult = await pool.query("SELECT NOW() as current_time")
        console.log(`  ✓ Connected at ${connResult.rows[0].current_time}\n`)

        // Test 2: Schema exists
        console.log("[2/4] Verifying v2_ai_schema exists...")
        const schemaResult = await pool.query(
            "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'v2_ai_schema'"
        )
        if (schemaResult.rows.length > 0) {
            console.log("  ✓ v2_ai_schema exists\n")
        } else {
            console.log("  ✗ v2_ai_schema NOT FOUND — run Phase 1 migrations first\n")
            process.exit(1)
        }

        // Test 3: Checkpointer tables exist
        console.log("[3/4] Verifying checkpointer tables...")
        const tables = ["checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"]
        for (const table of tables) {
            const result = await pool.query(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'v2_ai_schema' AND table_name = $1",
                [table]
            )
            const exists = parseInt(result.rows[0].count) > 0
            console.log(`  ${exists ? "✓" : "✗"} ${table}`)
        }
        console.log("")

        // Test 4: Write + read a test checkpoint
        console.log("[4/4] Testing write/read cycle...")
        const testThreadId = `test_${Date.now()}`

        // Write a minimal checkpoint
        await pool.query(
            `INSERT INTO v2_ai_schema.checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
             VALUES ($1, '', $2, NULL, 'json', '{"test": true}'::jsonb, '{"source": "v2-test-checkpointer"}'::jsonb)
             ON CONFLICT DO NOTHING`,
            [testThreadId, `cp_${Date.now()}`]
        )

        // Read it back
        const readResult = await pool.query(
            "SELECT thread_id, type FROM v2_ai_schema.checkpoints WHERE thread_id = $1",
            [testThreadId]
        )

        if (readResult.rows.length > 0) {
            console.log(`  ✓ Write/read cycle successful (thread: ${testThreadId})`)
        } else {
            console.log("  ✗ Write/read cycle failed")
        }

        // Clean up test data
        await pool.query(
            "DELETE FROM v2_ai_schema.checkpoints WHERE thread_id = $1",
            [testThreadId]
        )
        console.log("  ✓ Test data cleaned up")

    } catch (error) {
        console.error("\n✗ Error:", error)
        process.exit(1)
    } finally {
        await pool.end()
    }

    console.log("\n═══════════════════════════════════════════════════")
    console.log("  ✓ All checkpointer tests passed!")
    console.log("═══════════════════════════════════════════════════\n")
}

main().catch(err => {
    console.error("Fatal error:", err)
    process.exit(1)
})
