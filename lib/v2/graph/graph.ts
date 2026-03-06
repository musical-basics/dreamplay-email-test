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
 * The Analyst routes and classifies intent.
 * The Researcher gathers audience context + knowledge search.
 * The Drafter generates HTML via Claude.
 * The Critic validates and may loop back (max 2 revisions).
 */

function routeAfterCritic(state: EmailState): string {
    if (state.critic_feedback !== "PASS" && (state.revision_count || 0) < 2) {
        console.log(`[V2 EmailGraph] Critic FAIL — looping back to Drafter (revision ${state.revision_count})`)
        return "drafter"
    }
    return END
}

/**
 * Build the compiled V2 email generation graph.
 * Checkpointer uses v2_ai_schema (pre-provisioned, no setup()).
 */
export function buildEmailGraph() {
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

    return graph.compile({ checkpointer })
}
