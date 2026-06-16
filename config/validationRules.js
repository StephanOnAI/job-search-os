/* config/validationRules.js — SINGLE SOURCE OF TRUTH for the app's hard invariants.
 *
 * Declarative description of the rules the app must always satisfy. Read by the diagnostics panel
 * (to show what is enforced) and by scripts/local-checks.js (which checks the structural ones against
 * index.html). The behavioural ones are enforced by the existing gate (checks/verify.mjs,
 * checks/sendready.test.mjs, checks/banned.mjs) and are listed here for traceability, not re-implemented.
 *
 * Works as a browser <script> and as a Node require(). Bump `version` when an invariant changes.
 */
(function (root) {
  var data = {
    version: "2026-06-07",
    decisionLabels: ["priority_apply", "warm_outreach", "verify_first", "backup_only", "monitor", "reject"],
    invariants: [
      { id: "no_auto_send", text: "Email is never auto-sent. Sending only ever opens a Gmail/mailto compose window on an explicit click.", enforcedBy: "static-scan + design" },
      { id: "no_ai_on_render", text: "No AI model is called when a page or tab is opened. The browser app makes zero AI calls. AI runs only in offline review scripts (npm run review:board).", enforcedBy: "static-scan (local-checks)" },
      { id: "six_labels_only", text: "Only the six decision labels appear; the set is frozen and asserted at load.", enforcedBy: "verify + load assertion" },
      { id: "draft_gating", text: "Email drafts generate only for priority_apply / warm_outreach / verify_first (with a contact or portal path). Never for reject/monitor/backup_only.", enforcedBy: "verify (draftAllowed)" },
      { id: "send_ready_strict", text: "sendReady is false unless: actionable label, not gated, JD on file, verified named contact, email present, assets exist, pay known and at/above band, key facts known. A guessed/pattern email is never sendReady.", enforcedBy: "checks/sendready.test.mjs" },
      { id: "no_banned_wording", text: "No banned or inaccurate profile wording in any generated output (no loose metrics, never personally running the multi-country close/filings).", enforcedBy: "checks/banned.mjs" },
      { id: "email_style", text: "Outreach emails carry no banned weak phrase, no em dash, no semicolon, exactly one compensation question, named a Big 4 firm clients only on audit-heavy roles.", enforcedBy: "emailStyleCheck + config/emailStyleRules.js" },
      { id: "comp_policy_fixed", text: "Compensation policy is fixed; SGD 300k+ is the target not a cap; high-pay roles are never suppressed.", enforcedBy: "verify + config/compensationPolicy.js" },
      { id: "pii_masking", text: "Share/demo mode (window.DEMO) redacts phone, LinkedIn and all recruiter emails and phones. The raw private export is never shared.", enforcedBy: "verify (redactJson)" },
      { id: "no_fabricated_contacts", text: "Never fabricate a person or email or SMTP-probe. Outreach reaches only a real named contact from the ad, and derived emails are shown as 'likely, verify'.", enforcedBy: "design + resolveEmail" }
    ]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = data;
  else root.VALIDATION_RULES = data;
})(typeof window !== "undefined" ? window : globalThis);
