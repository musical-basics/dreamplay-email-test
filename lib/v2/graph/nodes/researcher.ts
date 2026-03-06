import { getAllContextForAudience, formatContextForPrompt } from "@/app/actions/settings"
import { knowledgeTool } from "../tools/knowledgeTool"
import type { EmailState } from "../state"

/**
 * V2 Node: Researcher
 *
 * Gathers all context needed for email generation:
 * 1. Audience-driven company context + default links (from ai_settings)
 * 2. Research data from dreamplay-knowledge vector search (via knowledgeTool)
 *
 * Logic extracted from email copilot/route.ts context assembly (lines 136-138).
 * Uses the existing getAllContextForAudience() server action.
 */
export async function researcherNode(state: EmailState): Promise<Partial<EmailState>> {
    const audience = (state.audienceContext || "dreamplay") as "dreamplay" | "musicalbasics" | "both"
    console.log(`[V2 Researcher] Gathering context for audience: ${audience}`)

    // ── 1. Fetch audience-driven context ──────────────────
    let dynamicContext = ""
    let linksBlock = ""

    try {
        const payload = await getAllContextForAudience(audience)
        const formatted = await formatContextForPrompt(payload, audience)
        dynamicContext = formatted.contextBlock
        linksBlock = formatted.linksBlock
        console.log(`[V2 Researcher] Audience context loaded (${dynamicContext.length} chars)`)
    } catch (error) {
        console.error("[V2 Researcher] Error fetching audience context:", error)
    }

    // ── 2. Knowledge search (if not a simple question) ────
    let researchBlock = ""
    const researchDocs: { id: string; title: string; url: string | null }[] = []

    if (!state.isQuestion) {
        try {
            console.log(`[V2 Researcher] Searching knowledge base...`)
            const searchResult = await knowledgeTool.invoke({
                query: state.intentSummary || state.userPrompt,
                topK: 2,
            })

            if (searchResult && !searchResult.includes("No relevant research") && !searchResult.includes("unavailable")) {
                researchBlock = searchResult
                console.log(`[V2 Researcher] Knowledge search returned results`)
            } else {
                console.log(`[V2 Researcher] No relevant research found`)
            }
        } catch (error) {
            console.error("[V2 Researcher] Knowledge search error:", error)
        }
    } else {
        console.log(`[V2 Researcher] Skipping knowledge search (question detected)`)
    }

    return {
        dynamicContext,
        linksBlock,
        researchBlock,
        researchDocs,
        aiDossier: state.aiDossier || "",
    }
}
