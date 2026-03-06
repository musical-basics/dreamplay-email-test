import { StateGraph, END } from "@langchain/langgraph"
import { EmailGraphState, type EmailState } from "./state"
import { getCheckpointer } from "./checkpointer"
import { analystNode } from "./nodes/analyst"
import { researcherNode } from "./nodes/researcher"
import { drafterNode } from "./nodes/drafter"
import { criticNode } from "./nodes/critic"

/**
 * V2 Email Generation Graph
 *
 * Flow:
 *   Analyst → Researcher → Drafter → Critic
 *                            ↑           │
 *                            └── (FAIL) ──┘
 *                                   │
 *                                (PASS) → END
 *
 * Options:
 * - interruptBeforeCritic: If true, the graph pauses before the critic node
 *   for human review. Use the Command-based resume endpoint to continue.
 */

function routeAfterCritic(state: EmailState): string {
    if (state.critic_feedback !== "PASS" && (state.revision_count || 0) < 2) {
        console.log(`[V2 EmailGraph] Critic FAIL — looping back to Drafter (revision ${state.revision_count})`)
        return "drafter"
    }
    return END
}

interface BuildOptions {
    /**
     * If true, adds an interruptBefore breakpoint on the critic node.
     * This pauses the graph after Drafter completes, allowing the user
     * to review the draft before QA runs. Resume via Command object.
     */
    interruptBeforeCritic?: boolean
}

/**
 * Build the compiled V2 email generation graph.
 * Checkpointer uses v2_ai_schema (pre-provisioned, no setup()).
 */
export function buildEmailGraph(options: BuildOptions = {}) {
    const checkpointer = getCheckpointer()

    const graph = new StateGraph(EmailGraphState)
        // ── Add nodes ────────────────────────────────────
        .addNode("analyst", analystNode)
        .addNode("researcher", researcherNode)
        .addNode("drafter", drafterNode)
        .addNode("critic", criticNode)

        // ── Entry point ──────────────────────────────────
        .addEdge("__start__", "analyst")

        // ── Linear flow ──────────────────────────────────
        .addEdge("analyst", "researcher")
        .addEdge("researcher", "drafter")
        .addEdge("drafter", "critic")

        // ── Critic → loop or END ─────────────────────────
        .addConditionalEdges("critic", routeAfterCritic, {
            drafter: "drafter",
            [END]: END,
        })

    const compileOptions: Record<string, unknown> = { checkpointer }

    if (options.interruptBeforeCritic) {
        compileOptions.interruptBefore = ["critic"]
    }

    return graph.compile(compileOptions)
}

