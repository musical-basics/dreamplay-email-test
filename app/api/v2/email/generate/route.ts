import { NextResponse } from "next/server"
import { buildEmailGraph } from "@/lib/v2/graph/graph"
import type { EmailState } from "@/lib/v2/graph/state"

/**
 * V2 Email Generation API — SSE Endpoint
 *
 * POST /api/v2/email/generate
 *
 * Executes the V2 LangGraph email pipeline and streams progress
 * via Server-Sent Events using streamEvents (Directive 4).
 *
 * The client receives node-level status updates ("Analyzing...",
 * "Researching...", "Drafting...", "Auditing...") in real-time.
 *
 * Request body:
 * {
 *   currentHtml: string,
 *   messages: Array<{ role: string, content: string, imageUrls?: string[] }>,
 *   model?: string,
 *   audienceContext?: string,
 *   aiDossier?: string,
 *   thread_id?: string,  // For resuming a conversation
 * }
 */

// ── Helper: Convert image URL to Base64 ──────────────────
async function urlToBase64(url: string) {
    try {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Failed: ${response.statusText}`)
        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        return {
            base64: buffer.toString("base64"),
            mediaType: response.headers.get("content-type") || "image/jpeg",
        }
    } catch (e) {
        console.error("Image fetch failed", e)
        return null
    }
}

// ── Node name → user-facing status ───────────────────────
const NODE_LABELS: Record<string, string> = {
    analyst: "Analyzing request...",
    researcher: "Gathering context...",
    drafter: "Drafting email...",
    critic: "Auditing quality...",
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const {
            currentHtml = "",
            messages = [],
            model = "auto",
            audienceContext = "dreamplay",
            aiDossier = "",
            thread_id,
        } = body

        // Process images server-side (last 3 messages only)
        const processedMessages = await Promise.all(
            messages.map(async (msg: { role: string; content: string; imageUrls?: string[] }, index: number) => {
                const isRecent = index >= messages.length - 3
                let images: Array<{ base64: string; mediaType: string }> = []

                if (isRecent && msg.imageUrls && msg.imageUrls.length > 0) {
                    const downloads = await Promise.all(msg.imageUrls.map(urlToBase64))
                    images = downloads.filter((img): img is NonNullable<typeof img> => img !== null)
                }

                return {
                    role: msg.role,
                    content: msg.content,
                    images,
                }
            })
        )

        const lastUserMessage = messages.filter((m: { role: string }) => m.role === "user").pop()

        // Build initial state
        const initialState: Partial<EmailState> = {
            userPrompt: lastUserMessage?.content || "",
            currentHtml,
            audienceContext,
            platform: "email",
            messages: processedMessages,
            modelTier: model,
            aiDossier,
        }

        const threadId = thread_id || `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

        const compiledGraph = buildEmailGraph()

        // ── SSE Stream using streamEvents (Directive 4) ──
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
            async start(controller) {
                const sendEvent = (event: string, data: Record<string, unknown>) => {
                    controller.enqueue(
                        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                    )
                }

                sendEvent("status", { status: "starting", thread_id: threadId })

                try {
                    const eventStream = await compiledGraph.streamEvents(initialState, {
                        version: "v2",
                        configurable: { thread_id: threadId },
                    })

                    let lastNodeName = ""

                    for await (const event of eventStream) {
                        // Map node traversal to UI status updates
                        if (event.event === "on_chain_start" && event.name && NODE_LABELS[event.name]) {
                            if (event.name !== lastNodeName) {
                                lastNodeName = event.name
                                sendEvent("status", {
                                    status: "node_start",
                                    node: event.name,
                                    label: NODE_LABELS[event.name],
                                })
                            }
                        }

                        if (event.event === "on_chain_end" && event.name && NODE_LABELS[event.name]) {
                            sendEvent("status", {
                                status: "node_end",
                                node: event.name,
                            })
                        }
                    }

                    // Get final state
                    const finalState = await compiledGraph.getState({
                        configurable: { thread_id: threadId },
                    })

                    const state = finalState.values as EmailState

                    // Build response matching existing copilot format
                    const result: Record<string, unknown> = {
                        updatedHtml: state.finalHtml || state.draftHtml || currentHtml,
                        explanation: state.explanation || "Changes applied.",
                        meta: state.usageMeta || { model: state.resolvedModel, inputTokens: 0, outputTokens: 0, cost: 0 },
                        thread_id: threadId,
                    }

                    if (state.routingReason) {
                        result.explanation = `*(⚡️ ${state.routingReason})*\n\n${result.explanation}`
                    }

                    sendEvent("result", result)
                    sendEvent("done", {})
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : "Unknown error"
                    console.error("[V2 Generate] Error:", error)
                    sendEvent("error", { error: message })
                } finally {
                    controller.close()
                }
            },
        })

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        })
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        console.error("[V2 Generate] Request error:", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
