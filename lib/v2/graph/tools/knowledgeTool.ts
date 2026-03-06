import { tool } from "@langchain/core/tools"
import { z } from "zod"

/**
 * V2 Tool: Knowledge Search
 *
 * Queries the dreamplay-knowledge semantic search API for relevant
 * research context. Uses strict zod schema to prevent hallucinated args.
 *
 * Directive 2: Strict Tool Schemas (zod)
 */

const KNOWLEDGE_API_URL = process.env.NEXT_PUBLIC_KNOWLEDGE_API_URL || "http://localhost:3004"
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || ""

export const knowledgeTool = tool(
    async ({ query, topK }): Promise<string> => {
        console.log(`[V2 KnowledgeTool] Searching: "${query}" (topK: ${topK})`)

        try {
            const response = await fetch(
                `${KNOWLEDGE_API_URL}/api/v2/knowledge/llamaindex-search`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-internal-api-secret": INTERNAL_API_SECRET,
                    },
                    body: JSON.stringify({ query, topK }),
                }
            )

            if (!response.ok) {
                const errorBody = await response.text()
                console.error(`[V2 KnowledgeTool] API error: ${response.status} ${errorBody}`)
                return `Knowledge search failed (HTTP ${response.status}). Continuing without research.`
            }

            const data = await response.json()

            if (!data.results || data.results.length === 0) {
                return "No relevant research found for this query."
            }

            // Format results for the LLM context
            const formatted = data.results.map((r: {
                score: number
                metadata: { title: string; author: string; year: string }
                text: string
            }, i: number) =>
                `[${i + 1}] "${r.metadata.title}" by ${r.metadata.author} (${r.metadata.year}) [score: ${r.score.toFixed(3)}]\n${r.text}`
            ).join("\n\n---\n\n")

            console.log(`[V2 KnowledgeTool] Found ${data.results.length} results`)
            return formatted
        } catch (error) {
            console.error("[V2 KnowledgeTool] Error:", error)
            return "Knowledge search unavailable. Continuing without research."
        }
    },
    {
        name: "knowledge_search",
        description: "Search the DreamPlay research vector database for relevant context, studies, and data to support email content generation. Use this when the email needs factual backing, research citations, or brand knowledge.",
        schema: z.object({
            query: z.string().describe("The exact semantic search query to find relevant research"),
            topK: z.number().optional().default(3).describe("Number of results to return (1-10)"),
        }),
    }
)
