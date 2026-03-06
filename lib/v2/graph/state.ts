import { Annotation } from "@langchain/langgraph"

/**
 * V2 Email Generation Pipeline — State Definition
 *
 * This state flows through the email-specific LangGraph nodes:
 *   Analyst → Researcher → Drafter → Critic → [loop or END]
 *
 * The Analyst determines intent from the user message and audience context.
 * The Researcher fetches relevant knowledge from dreamplay-knowledge.
 * The Drafter generates HTML email using Claude or Gemini.
 * The Critic validates output and may loop back to Drafter.
 */

export const EmailGraphState = Annotation.Root({
    // ── Input fields ─────────────────────────────────────
    userPrompt: Annotation<string>,
    currentHtml: Annotation<string>,
    audienceContext: Annotation<string>,
    platform: Annotation<string>({
        reducer: (_current, update) => update,
        default: () => "email",
    }),

    // ── Message history (for multi-turn copilot) ─────────
    messages: Annotation<Array<{
        role: string
        content: string
        images?: Array<{ base64: string; mediaType: string }>
    }>>({
        reducer: (_current, update) => update,
        default: () => [],
    }),

    // ── Smart Router fields ──────────────────────────────
    modelTier: Annotation<string>({
        reducer: (_current, update) => update,
        default: () => "auto",
    }),
    routingReason: Annotation<string>({
        reducer: (_current, update) => update,
        default: () => "",
    }),
    resolvedModel: Annotation<string>,

    // ── Analyst output ───────────────────────────────────
    intentSummary: Annotation<string>,
    isQuestion: Annotation<boolean>({
        reducer: (_current, update) => update,
        default: () => false,
    }),

    // ── Context (populated by Researcher) ────────────────
    dynamicContext: Annotation<string>,
    linksBlock: Annotation<string>,
    researchBlock: Annotation<string>,
    researchDocs: Annotation<Array<{ id: string; title: string; url: string | null }>>({
        reducer: (_current, update) => update,
        default: () => [],
    }),
    aiDossier: Annotation<string>,

    // ── Pipeline control ─────────────────────────────────
    revision_count: Annotation<number>({
        reducer: (current, update) => current + update,
        default: () => 0,
    }),
    critic_feedback: Annotation<string>({
        reducer: (_current, update) => update,
        default: () => "",
    }),

    // ── Pipeline outputs ─────────────────────────────────
    draftHtml: Annotation<string>,
    finalHtml: Annotation<string>,
    explanation: Annotation<string>,
    citedResearchIds: Annotation<string[]>({
        reducer: (_current, update) => update,
        default: () => [],
    }),

    // ── Usage tracking ───────────────────────────────────
    usageMeta: Annotation<{
        model: string
        inputTokens: number
        outputTokens: number
        cost: number
    } | null>({
        reducer: (_current, update) => update,
        default: () => null,
    }),
})

/**
 * Type alias for the email graph state
 */
export type EmailState = typeof EmailGraphState.State
