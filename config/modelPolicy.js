/* config/modelPolicy.js — SINGLE SOURCE OF TRUTH for model-usage policy (tiers).
 *
 * Policy for WHEN to spend a stronger (costlier) model vs deterministic code / a cheap model.
 * Today the app's emails, extraction and decisions are fully DETERMINISTIC (no model), and the
 * Review Counsel runs on free models. This file documents the intended tiers and is structured so a
 * paid "strong" tier can be slotted in later without rework. No behaviour change on its own.
 *
 * Works as a browser <script> and as a Node require(). Bump `version` when the policy changes.
 */
(function (root) {
  var data = {
    version: "2026-06-07",
    principle: "Deterministic by default. A model runs only on an explicit user action, and its output is cached. Prefer the cheap tier; reserve the strong tier for genuinely hard, high-value text.",
    tiers: {
      none: {
        use: ["email extraction", "phone/name/EA-reg extraction", "salary range", "follow-up date", "verdict display", "table sorting", "badge tooltips", "pipeline status", "the recruiter emails themselves (template-based)"],
        how: "plain deterministic code — no model, no credits"
      },
      cheap: {
        use: ["classification", "bulk re-ranking of newly imported roles", "Review Counsel board members"],
        examples: ["groq:llama-3.1-8b-instant", "gemini-2.5-flash", "ollama:qwen2.5 (local, free)"]
      },
      strong: {
        use: ["final recruiter emails when a human asks to improve a draft", "difficult role judgement", "Review Counsel chair", "ambiguous recruiter replies"],
        examples: ["groq:llama-3.3-70b-versatile (chair today, free)", "openai:gpt-4o (paid, opt-in via OPENAI_API_KEY)"]
      }
    },
    notes: "Cache every model output by a stable key (role + jdHash + profile/style/comp versions for per-role work; slimmed package + member/chair + config versions for the board). Reuse on an unchanged key instead of regenerating."
  };
  if (typeof module !== "undefined" && module.exports) module.exports = data;
  else root.MODEL_POLICY = data;
})(typeof window !== "undefined" ? window : globalThis);
