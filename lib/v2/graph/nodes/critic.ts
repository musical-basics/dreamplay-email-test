import { GoogleGenAI } from "@google/genai"
import type { EmailState } from "../state"

/**
 * V2 Node: Critic
 *
 * QA review of the drafted email HTML. Checks:
 * 1. All sections from the original HTML are preserved
 * 2. {{mustache_vars}} are intact and properly named
 * 3. Email coding standards are followed (tables, not flexbox)
 * 4. Copy quality matches the intent
 *
 * Returns PASS or FAIL with feedback. FAIL triggers a Drafter loop (max 2).
 */

const MAX_REVISIONS = 2

export async function criticNode(state: EmailState): Promise<Partial<EmailState>> {
    const currentRevision = (state.revision_count || 0) + 1
    console.log(`[V2 Critic] Auditing draft (revision ${currentRevision})...`)

    // Skip audit for questions (no HTML modification expected)
    if (state.isQuestion) {
        console.log(`[V2 Critic] Skipping audit (question detected)`)
        return {
            finalHtml: state.draftHtml || state.currentHtml || "",
            critic_feedback: "PASS",
            revision_count: 1,
        }
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
            role: "user",
            parts: [{
                text: `You are a strict QA Auditor for email HTML. Review the DRAFT HTML against the ORIGINAL HTML and the user's intent.

USER INTENT: ${state.intentSummary || state.userPrompt}

ORIGINAL HTML (${state.currentHtml ? state.currentHtml.length : 0} chars):
${state.currentHtml ? state.currentHtml.substring(0, 2000) + (state.currentHtml.length > 2000 ? "\n... [truncated]" : "") : "No original (new template)"}

DRAFT HTML (${state.draftHtml ? state.draftHtml.length : 0} chars):
${state.draftHtml ? state.draftHtml.substring(0, 3000) + (state.draftHtml.length > 3000 ? "\n... [truncated]" : "") : "Empty draft"}

AUDIT CHECKLIST:
1. Does the draft start with <!DOCTYPE html> and end with </html>?
2. If there was original HTML — are ALL original sections preserved (unless user asked to remove)?
3. Are {{mustache_vars}} intact? Image vars end with _src/_bg/_logo/_icon/_img?
4. Is the layout table-based (no flexbox/grid)?
5. No em-dashes (—) in copy text?
6. Does the draft fulfill the user's intent?

Output ONLY a JSON object:
{
  "verdict": "PASS" or "FAIL",
  "issues": ["list of specific issues found"],
  "feedback": "Concise feedback for the Drafter to fix (only if FAIL)"
}

FAIL only for critical issues: missing sections, broken structure, lost content.
Minor style preferences are not grounds for FAIL.`
            }]
        }]
    })

    const rawText = (response.text || "").trim()
    let verdict = "PASS"
    let feedback = ""

    try {
        let jsonStr = rawText
        if (jsonStr.startsWith("```json")) jsonStr = jsonStr.replace(/^```json\n/, "").replace(/\n```$/, "")
        else if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```\n/, "").replace(/\n```$/, "")

        const parsed = JSON.parse(jsonStr)
        verdict = parsed.verdict === "FAIL" ? "FAIL" : "PASS"
        feedback = parsed.feedback || ""

        if (parsed.issues && parsed.issues.length > 0) {
            console.log(`[V2 Critic] Issues: ${parsed.issues.join(", ")}`)
        }
    } catch {
        verdict = "PASS" // If we can't parse, pass through
        console.warn("[V2 Critic] Could not parse audit response, defaulting to PASS")
    }

    // Cap revisions
    if (verdict === "FAIL" && currentRevision >= MAX_REVISIONS) {
        console.log(`[V2 Critic] Max revisions (${MAX_REVISIONS}) reached, forcing PASS`)
        verdict = "PASS"
    }

    console.log(`[V2 Critic] Verdict: ${verdict} (revision ${currentRevision})`)

    return {
        finalHtml: verdict === "PASS" ? (state.draftHtml || state.currentHtml || "") : undefined,
        critic_feedback: verdict === "FAIL" ? feedback : "PASS",
        revision_count: 1, // Additive reducer: +1 per audit pass
    }
}
