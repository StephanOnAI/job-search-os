/* config/reviewCounselRules.js — SINGLE SOURCE OF TRUTH for what the Review Counsel checks.
 *
 * The QA checklist the Review Counsel acts on as a gate. Each rule has a `kind`:
 *   "static"  — checked deterministically against index.html by scripts/local-checks.js
 *   "gate"    — already enforced by the local gate (checks/verify.mjs / sendready / banned), folded
 *               into the review package via checks/verify-report.json + checks/banned-report.json
 *   "model"   — a judgement the AI board weighs (e.g. label intuitiveness), never a hard blocker on its own
 * `hardBlocker:true` means a failure forces previewReady=false regardless of score.
 *
 * Works as a browser <script> and as a Node require(). Bump `version` when the checklist changes.
 */
(function (root) {
  var data = {
    version: "2026-06-07",
    rules: [
      { id: "no_auto_send", kind: "static", hardBlocker: true, text: "No auto-send: email leaves only via a Gmail/mailto compose window on an explicit user click." },
      { id: "no_ai_on_render", kind: "static", hardBlocker: true, text: "App does not call AI on page/tab load. No AI endpoint or model SDK is used in the browser." },
      { id: "no_weak_recruiter_language", kind: "gate", hardBlocker: false, text: "No banned weak/inaccurate phrase in any generated email (config/emailStyleRules.js + emailStyleCheck)." },
      { id: "no_duplicate_compensation_question", kind: "gate", hardBlocker: false, text: "An email asks for the compensation range at most once." },
      { id: "no_inaccurate_close_or_filing_claim", kind: "gate", hardBlocker: true, text: "No claim that there personally runs the multi-country close or filings (checks/banned.mjs)." },
      { id: "kpmg_wording_safe", kind: "gate", hardBlocker: false, text: "Named a Big 4 firm clients (a global group/a global group/a global group) appear only on audit-heavy roles." },
      { id: "contact_extraction_works", kind: "static", hardBlocker: false, text: "Deterministic contact extraction (adContact/eaName/resolveEmail) is present and runs first." },
      { id: "followup_pipeline_works", kind: "gate", hardBlocker: false, text: "The follow-up pipeline (pipeStageOf/followUp working-day timing) drives the Tracker." },
      { id: "rejected_no_prominent_draft", kind: "gate", hardBlocker: false, text: "Rejected roles do not surface prominent draft/apply actions (draftAllowed=false for reject)." },
      { id: "ui_labels_intuitive", kind: "model", hardBlocker: false, text: "Tab and decision labels read intuitively to a first-time user." },
      { id: "no_unnecessary_ai", kind: "static", hardBlocker: false, text: "The app uses deterministic code by default and caches AI outputs; AI runs only on explicit user actions." }
    ]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = data;
  else root.REVIEW_COUNSEL_RULES = data;
})(typeof window !== "undefined" ? window : globalThis);
