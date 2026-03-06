import { inngest } from "@/inngest/client"
import { buildEmailGraph } from "@/lib/v2/graph/graph"
import type { EmailState } from "@/lib/v2/graph/state"

/**
 * V2 LangGraph Email Generation — Inngest Function
 *
 * Runs the V2 email generation graph as a background Inngest job.
 * This is useful for long-running generation tasks that shouldn't
 * block the API response (e.g., batch generation, scheduled generation).
 *
 * Trigger event: "v2/email.generate"
 *
 * Event data:
 * {
 *   thread_id: string,
 *   userPrompt: string,
 *   currentHtml: string,
 *   audienceContext: string,
 *   model?: string,
 *   interruptBeforeCritic?: boolean,
 * }
 */
export const v2EmailGeneration = inngest.createFunction(
    {
        id: "v2-email-generation",
        name: "V2 Email LangGraph Generation",
        retries: 1,
    },
    { event: "v2/email.generate" },
    async ({ event, step }) => {
        const {
            thread_id,
            userPrompt,
            currentHtml = "",
            audienceContext = "dreamplay",
            model = "auto",
            aiDossier = "",
            interruptBeforeCritic = false,
        } = event.data

        // Step 1: Build initial state
        const initialState = await step.run("build-state", () => {
            return {
                userPrompt,
                currentHtml,
                audienceContext,
                platform: "email",
                modelTier: model,
                aiDossier,
                messages: [{ role: "user", content: userPrompt }],
            } as Partial<EmailState>
        })

        // Step 2: Execute the graph
        const result = await step.run("execute-graph", async () => {
            const compiledGraph = buildEmailGraph({ interruptBeforeCritic })

            const graphResult = await compiledGraph.invoke(
                initialState,
                { configurable: { thread_id } }
            )

            const finalState = graphResult as EmailState

            return {
                thread_id,
                finalHtml: finalState.finalHtml || finalState.draftHtml || currentHtml,
                explanation: finalState.explanation || "Changes applied.",
                resolvedModel: finalState.resolvedModel,
                routingReason: finalState.routingReason,
                revision_count: finalState.revision_count,
                usageMeta: finalState.usageMeta,
                citedResearchIds: finalState.citedResearchIds,
            }
        })

        // Step 3: Send completion event
        await step.sendEvent("notify-complete", {
            name: "v2/email.generate.completed",
            data: {
                thread_id: result.thread_id,
                finalHtml: result.finalHtml,
                explanation: result.explanation,
                usageMeta: result.usageMeta,
            },
        })

        return result
    }
)
