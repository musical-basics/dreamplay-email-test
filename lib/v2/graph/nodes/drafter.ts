import Anthropic from "@anthropic-ai/sdk"
import type { EmailState } from "../state"

/**
 * V2 Node: Drafter
 *
 * Generates or modifies email HTML using Claude (model selected by Analyst).
 * Contains the full system instruction from the existing copilot route.
 *
 * Logic extracted from email copilot/route.ts Claude branch (lines 237-292).
 */
export async function drafterNode(state: EmailState): Promise<Partial<EmailState>> {
    const model = state.resolvedModel || "claude-sonnet-4-20250514"
    console.log(`[V2 Drafter] Generating with ${model} (revision ${state.revision_count || 0})...`)

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    // ── Build system instruction ──────────────────────────
    const systemInstruction = `
You are an expert Email HTML Developer.
The user will give you HTML and a request.

### 🛑 CRITICAL INTEGRITY RULES:
1. **NEVER DELETE CONTENT:** Unless explicitly asked to remove something, you must PRESERVE ALL existing sections, text, images, and structure.
2. **ALWAYS RETURN THE COMPLETE HTML DOCUMENT** starting with <!DOCTYPE html> and ending with </html>. Include EVERY section from the original HTML.
3. **EDITING TEXT = FULL HTML:** Even for small text changes, return the full HTML document.

### CODING STANDARDS:
1. **LAYOUT:** Use HTML <table>, <tr>, <td> for structure. No Flexbox/Grid.
2. **WIDTHS:** Explicitly set width="100%" or specific pixels.
3. **VARIABLES:** Preserve {{mustache_vars}}.
4. **IMAGE VARIABLES:** Variable name MUST end with _src, _bg, _logo, _icon, _img — or contain "image" or "url". ALWAYS wrap in clickable link: <a href="{{hero_link_url}}"><img src="{{hero_src}}" /></a>.
5. **NO EM-DASHES:** Never use em-dashes (—). Use commas, periods, or semicolons.
6. **READABLE COPY:** Use <strong> for 1-2 key value propositions and <u> for one supporting detail per paragraph.

### TEMPLATE CREATION DEFAULTS:
When asked to create a NEW email template:
- All text/copy MUST be hardcoded directly in the HTML.
- All image sources (src) MUST use {{mustache_variable}} names.
- All links (href on <a> tags) MUST use {{mustache_variable}} names.

### RESPONSE FORMAT (STRICT JSON ONLY):
{
  "_thoughts": "Step-by-step analysis of what needs to change",
  "explanation": "Brief, friendly summary of changes for the user",
  "updatedHtml": "<!DOCTYPE html>\\n<html>...</html>"
}

### CRITICAL: QUESTION vs EDIT DETECTION:
If the user is asking a QUESTION:
- Set "updatedHtml" to the EXACT ORIGINAL HTML unchanged
- Put your full answer in the "explanation" field

### COMPANY CONTEXT:
${state.dynamicContext || ""}
${state.linksBlock || ""}
${state.aiDossier ? `\n### AUDIENCE INTELLIGENCE:\n${state.aiDossier}` : ""}
${state.researchBlock ? `\n### RESEARCH DATA:\n${state.researchBlock}` : ""}
${state.critic_feedback ? `\n### PREVIOUS AUDIT FEEDBACK (please address these issues):\n${state.critic_feedback}` : ""}
`

    // ── Build messages ────────────────────────────────────
    const anthropicMessages = (state.messages || []).map(msg => {
        const role = (msg.role === "result" ? "assistant" : "user") as "assistant" | "user"
        const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = []

        // Add images
        if (msg.images && msg.images.length > 0) {
            for (const img of msg.images) {
                content.push({
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: img.mediaType,
                        data: img.base64,
                    },
                })
            }
        }

        // Add text
        if (msg.content) content.push({ type: "text", text: msg.content })

        return { role, content }
    })

    // Append current HTML to last message
    const lastMsg = anthropicMessages[anthropicMessages.length - 1]
    if (lastMsg && lastMsg.role === "user") {
        lastMsg.content.push({
            type: "text",
            text: `\n\n### CURRENT HTML:\n${state.currentHtml || ""}`,
        })
    }

    // ── Call Claude ────────────────────────────────────────
    const stream = anthropic.messages.stream({
        model,
        max_tokens: 32768,
        temperature: 0,
        system: systemInstruction,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: anthropicMessages as any,
    })

    const msg = await stream.finalMessage()

    let rawResponse = ""
    const textBlock = msg.content[0]
    if (textBlock.type === "text") rawResponse = textBlock.text

    // ── Track usage ───────────────────────────────────────
    const PRICING: Record<string, { input: number; output: number }> = {
        "claude-3-5-haiku-latest": { input: 0.80, output: 4.00 },
        "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
        "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
        "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
    }

    let usageMeta = { model, inputTokens: 0, outputTokens: 0, cost: 0 }
    if (msg.usage) {
        const pricing = PRICING[model] || { input: 3, output: 15 }
        usageMeta = {
            model,
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
            cost: (msg.usage.input_tokens / 1_000_000 * pricing.input) +
                (msg.usage.output_tokens / 1_000_000 * pricing.output),
        }
    }

    // ── Parse response ────────────────────────────────────
    let draftHtml = state.currentHtml || ""
    let explanation = "Changes applied successfully."

    try {
        // Extract JSON from response
        const start = rawResponse.indexOf("{")
        const end = rawResponse.lastIndexOf("}")
        if (start !== -1 && end !== -1 && end > start) {
            const parsed = JSON.parse(rawResponse.substring(start, end + 1))
            if (parsed.updatedHtml) draftHtml = parsed.updatedHtml
            if (parsed.explanation) explanation = parsed.explanation
        }
    } catch {
        // Fallback: try to find raw HTML
        const docMatch = rawResponse.match(/(<!DOCTYPE html[\s\S]*?<\/html>)/i)
        if (docMatch) {
            draftHtml = docMatch[1]
        } else {
            console.error("[V2 Drafter] Could not parse response")
            explanation = "Generated content but output parsing failed. Please try again."
        }
    }

    console.log(`[V2 Drafter] Draft complete (${draftHtml.length} chars, cost: $${usageMeta.cost.toFixed(4)})`)

    return {
        draftHtml,
        explanation,
        usageMeta,
    }
}
