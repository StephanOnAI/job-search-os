/* config/compensationPolicy.js — SINGLE SOURCE OF TRUTH for compensation policy + tier thresholds.
 *
 * Canonical copy of the policy shown in the JSON export (index.html summary.compensationPolicy) and
 * the tier cut-offs implemented by compTierMid() in index.html and compTierOf() in pipeline/score.mjs.
 * Those two functions stay the implementation; this file is the documented source they mirror, and the
 * value the review cache versions off.
 *
 * POLICY IS FIXED HERE — do NOT weaken it. SGD 300k+ is the TARGET, not a cap: pay above 300 scores
 * HIGHER and is never hidden or rejected for being high. There is no "200k" and no single target band.
 * All figures are SGD thousands of total annual compensation.
 *
 * Works as a browser <script> and as a Node require(). Bump `version` ONLY with an intentional,
 * approved policy change.
 */
(function (root) {
  var data = {
    version: "2026-06-07",
    primaryTarget: "SGD 300k+ total annual compensation",
    seriousConsideration: "SGD 250k to 300k",
    verifyOnly: "SGD 220k to 250k",
    lowOrReject: "below SGD 220k unless exceptional",
    note: "SGD 300k+ is the target, not a cap. Higher pay is prioritised, never hidden.",
    /* Tier cut-offs, classified by MIDPOINT and MAX (not max alone). Mirrors compTierMid()/compTierOf(). */
    tiers: {
      target: "midpoint >= 300 or max >= 330",
      serious: "midpoint >= 250",
      verifyOnly: "max >= 220 but midpoint below 250",
      belowFloor: "max below 220",
      undisclosed: "no max disclosed (treated as verify-first)"
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = data;
  else root.COMPENSATION_POLICY = data;
})(typeof window !== "undefined" ? window : globalThis);
