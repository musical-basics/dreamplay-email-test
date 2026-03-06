"use client"

/**
 * V2 SSE Client — Fetches from the V2 LangGraph SSE endpoint
 *
 * Parses Server-Sent Events from /api/v2/email/generate (or /api/v2/blog/generate)
 * and returns the final result in the same shape as the V1 JSON response.
 *
 * Progress callback provides real-time node status updates to the UI.
 */

export interface V2ProgressEvent {
    status: string
    node?: string
    label?: string
}

export interface V2Result {
    updatedHtml: string
    explanation: string
    meta?: {
        model: string
        inputTokens: number
        outputTokens: number
        cost: number
    }
    suggestedAssets?: Record<string, string>
    suggestedThumbnail?: string
    thread_id?: string
}

export async function fetchV2SSE(
    endpoint: string,
    payload: Record<string, unknown>,
    onProgress?: (event: V2ProgressEvent) => void
): Promise<V2Result> {
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    })

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Request failed" }))
        throw new Error(error.error || `HTTP ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error("No response body")

    const decoder = new TextDecoder()
    let buffer = ""
    let result: V2Result | null = null

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events from buffer
        const lines = buffer.split("\n")
        buffer = lines.pop() || "" // Keep incomplete last line in buffer

        let eventType = ""
        for (const line of lines) {
            if (line.startsWith("event: ")) {
                eventType = line.slice(7).trim()
            } else if (line.startsWith("data: ")) {
                const data = line.slice(6)
                try {
                    const parsed = JSON.parse(data)

                    if (eventType === "status" && onProgress) {
                        onProgress(parsed as V2ProgressEvent)
                    } else if (eventType === "result") {
                        result = parsed as V2Result
                    } else if (eventType === "error") {
                        throw new Error(parsed.error || "Generation failed")
                    }
                } catch (e) {
                    if (e instanceof Error && e.message !== "Generation failed") {
                        // JSON parse error — skip malformed event
                        console.warn("[V2 SSE] Skipped malformed event:", data)
                    } else {
                        throw e
                    }
                }
                eventType = ""
            }
        }
    }

    if (!result) {
        throw new Error("No result received from V2 pipeline")
    }

    return result
}
