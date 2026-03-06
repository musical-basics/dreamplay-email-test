import { NextResponse } from "next/server"
import { Command } from "@langchain/langgraph"
import { buildEmailGraph } from "@/lib/v2/graph/graph"
import type { EmailState } from "@/lib/v2/graph/state"

/**
 * V2 Email HITL Resume API — Command Endpoint
 *
 * POST /api/v2/email/resume
 *
 * When the graph is suspended at an interruptBefore breakpoint (e.g., before
 * the critic node for human approval), this endpoint resumes execution using
 * the LangGraph Command object (Directive 3).
 *
 * Request body:
 * {
 *   thread_id: string,
 *   decision: "approved" | "rejected" | "edit",
 *   notes?: string,        // Human feedback or edit instructions
 *   editedHtml?: string,   // If human manually edited the HTML
 * }
 */
export async function POST(req: Request) {
    try {
        const { thread_id, decision, notes = "", editedHtml } = await req.json()

        if (!thread_id) {
            return NextResponse.json({ error: "thread_id is required" }, { status: 400 })
        }

        if (!decision) {
            return NextResponse.json({ error: "decision is required (approved, rejected, or edit)" }, { status: 400 })
        }

        console.log(`[V2 Resume] thread: ${thread_id}, decision: ${decision}`)

        const compiledGraph = buildEmailGraph()

        // Check current state
        const currentState = await compiledGraph.getState({
            configurable: { thread_id },
        })

        if (!currentState || !currentState.values) {
            return NextResponse.json({ error: "Thread not found or has no state" }, { status: 404 })
        }

        const state = currentState.values as EmailState

        // ── Handle decision ──────────────────────────────
        if (decision === "rejected") {
            // User rejected — return current state without continuing
            return NextResponse.json({
                updatedHtml: state.currentHtml || "",
                explanation: "Draft rejected. No changes applied.",
                thread_id,
                meta: state.usageMeta,
            })
        }

        // Build resume payload
        const resumePayload: Record<string, unknown> = {
            decision,
            notes,
        }

        // If user manually edited the HTML, inject it
        if (decision === "edit" && editedHtml) {
            resumePayload.editedHtml = editedHtml
        }

        // ── Resume graph using Command (Directive 3) ─────
        const result = await compiledGraph.invoke(
            new Command({ resume: resumePayload }),
            { configurable: { thread_id } }
        )

        const finalState = result as EmailState

        const response: Record<string, unknown> = {
            updatedHtml: finalState.finalHtml || finalState.draftHtml || state.currentHtml,
            explanation: finalState.explanation || "Changes applied after review.",
            thread_id,
            meta: finalState.usageMeta,
        }

        if (finalState.routingReason) {
            response.explanation = `*(⚡️ ${finalState.routingReason})*\n\n${response.explanation}`
        }

        return NextResponse.json(response)
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        console.error("[V2 Resume] Error:", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
