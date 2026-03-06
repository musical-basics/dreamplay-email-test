import { GoogleGenAI } from "@google/genai"
import type { EmailState } from "../state"

/**
 * V2 Node: Analyst
 *
 * Performs two tasks:
 * 1. Smart Router — classifies the request intent (SIMPLE edit vs COMPLEX generation)
 * 2. Intent Summary — extracts a structured summary of what the user wants
 *
 * Logic extracted from email copilot/route.ts Smart Router (lines 85-133).
 */
export async function analystNode(state: EmailState): Promise<Partial<EmailState>> {
    console.log(`[V2 Analyst] Analyzing request intent...`)

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

    const lastUserMessage = state.messages
        ?.filter(m => m.role === "user")
        .pop()

    const hasImages = (lastUserMessage?.images?.length ?? 0) > 0
    const isEmpty = !state.currentHtml || state.currentHtml.trim() === ""

    let resolvedModel = state.modelTier || "auto"
    let routingReason = ""
    let isQuestion = false

    // ── Smart Router Logic ────────────────────────────────
    if (resolvedModel === "auto") {
        if (isEmpty) {
            resolvedModel = "claude-sonnet-4-20250514"
            routingReason = "New template from scratch → Medium (Claude Sonnet)."
        } else if (hasImages) {
            resolvedModel = "claude-sonnet-4-20250514"
            routingReason = "Vision task (screenshot reference) → Medium (Claude Sonnet)."
        } else {
            // Gemini Flash classification
            try {
                const routerResponse = await ai.models.generateContent({
                    model: "gemini-2.5-flash",
                    contents: [{
                        role: "user",
                        parts: [{
                            text: `You are a routing agent for an email editor.
User request: "${lastUserMessage?.content || state.userPrompt}"
Is this a simple edit (changing text, fixing a typo, updating a color, swapping a link) or a complex edit (creating new layouts, adding new sections, structural redesign)?
Also determine: is this a QUESTION (asking for suggestions, brainstorming, feedback) or an EDIT (modifying HTML)?

Reply ONLY with a JSON object: {"complexity": "SIMPLE" or "COMPLEX", "isQuestion": true or false}
No other text.`
                        }]
                    }]
                })

                const rawText = (routerResponse.text || "").trim()
                try {
                    let jsonStr = rawText
                    if (jsonStr.startsWith("```json")) jsonStr = jsonStr.replace(/^```json\n/, "").replace(/\n```$/, "")
                    else if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```\n/, "").replace(/\n```$/, "")

                    const parsed = JSON.parse(jsonStr)
                    const complexity = (parsed.complexity || "").toUpperCase()
                    isQuestion = parsed.isQuestion === true

                    if (complexity.includes("COMPLEX")) {
                        resolvedModel = "claude-sonnet-4-20250514"
                        routingReason = "Complex structural edit → Medium (Claude Sonnet)."
                    } else {
                        resolvedModel = "claude-haiku-4-5-20251001"
                        routingReason = "Simple text/style edit → Low (Claude Haiku)."
                    }
                } catch {
                    resolvedModel = "claude-sonnet-4-20250514"
                    routingReason = "Router parse fallback → Medium (Claude Sonnet)."
                }
            } catch (e) {
                console.error("[V2 Analyst] Router error, defaulting to Medium:", e)
                resolvedModel = "claude-sonnet-4-20250514"
                routingReason = "Router error fallback → Medium (Claude Sonnet)."
            }
        }
    }

    // ── Intent Summary ────────────────────────────────────
    let intentSummary = state.userPrompt
    try {
        const summaryResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{
                role: "user",
                parts: [{
                    text: `Summarize the user's email editing request in 1-2 sentences. Focus on WHAT they want changed and WHY.

User request: "${state.userPrompt}"
${state.currentHtml ? `Existing HTML: ${state.currentHtml.length} chars` : "No existing HTML (new template)"}

Reply with ONLY the summary, no quotes.`
                }]
            }]
        })
        intentSummary = (summaryResponse.text || state.userPrompt).trim()
    } catch {
        // Fallback to raw prompt
    }

    console.log(`[V2 Analyst] Model: ${resolvedModel} | ${routingReason} | Question: ${isQuestion}`)

    return {
        resolvedModel,
        routingReason,
        isQuestion,
        intentSummary,
    }
}
