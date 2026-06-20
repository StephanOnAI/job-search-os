/* config/priorityAreas.js — SINGLE SOURCE OF TRUTH for what the Wisdom Counsel + Advisor Arena score HEAVIER.
 *
 * there's directive (2026-06-20): the things that touch HIM and the END USER directly should carry more
 * weight in the panel's scoring of points, so the advisors hunt them first. In descending weight:
 *   bugs/correctness > line-by-line content accuracy > job-by-job (per-role) accuracy >
 *   email drafts > CV download/view/tailoring > user experience > (everything else = baseline 1.0).
 *
 * `weight` is a MULTIPLIER on the points a fix earns (arena) and on the deterministic ranking (counsel). A
 * heavier area both scores more and is preferred when picking the next rung. `classify()` reads a proposal's
 * free text (its area tag + title) plus its type and returns the heaviest matching area.
 *
 * Works as a browser <script> (window.priorityAreas) and as a Node require(). Bump `version` on change.
 */
(function (root) {
  var areas = [
    { key: "bug",        label: "Bug / correctness",              weight: 3.0,
      match: "\\b(bug|broken|crash|error|throw(s|n)?|exception|undefined|\\bnan\\b|\\[object object\\]|invalid date|wrong|incorrect|mismatch|stale|leak|regression|fails?|null|inconsistent|does ?n.?t work)\\b" },
    { key: "perLine",    label: "Line-by-line content accuracy",  weight: 2.5,
      match: "\\b(line[- ]?by[- ]?line|wording|phras(e|ing)|sentence|copy(?!\\s*all)|claim|typo|grammar|em[- ]?dash|semicolon|banned[- ]?phrase|overclaim|metric as fact)\\b" },
    { key: "perRole",    label: "Job-by-job (per-role) accuracy", weight: 2.5,
      match: "\\b(per[- ]?role|job[- ]?by[- ]?job|role[- ]?level|each role|decision label|badge|fit ?score|lens|dedup|\\bjd\\b|recommendation|comp ?tier|send[- ]?ready)\\b" },
    { key: "emailDraft", label: "Email draft quality",            weight: 2.0,
      match: "\\b(email|draft|outreach template|first email|follow[- ]?up|messag(e|ing)|subject line|mailto|compose|recruiter note)\\b" },
    { key: "cvFlow",     label: "CV download / view / tailoring",  weight: 2.0,
      match: "\\b(cv|resume|cover ?letter|tailor(ing|ed)?|download|docx|\\bpdf\\b|view|preview|render(ing|ed)?|attachment|two pages|page count|measure)\\b" },
    { key: "ux",         label: "User experience",                weight: 1.8,
      match: "\\b(ux|user experience|navigat(e|ion)|tab|layout|mobile|responsive|usability|onboard(ing)?|confusing|clutter|three[- ]?click|load time|click|empty state|thin (view|surface))\\b" }
  ];

  var data = {
    version: "2026-06-20",
    base: 1.0,
    note: "Heavier weight = scores more and is preferred. Order is descending weight; classify() picks the heaviest match.",
    areas: areas,

    /* classify free text (area tag + title) + optional type → the heaviest-weight matching priority area.
       A proposal explicitly typed "bug" is always the bug area. Returns the baseline area when nothing matches. */
    classify: function (text, type) {
      if (type === "bug") return { key: "bug", label: "Bug / correctness", weight: 3.0 };
      var t = String(text || "").toLowerCase();
      var best = null;
      for (var i = 0; i < areas.length; i++) {
        var a = areas[i];
        try { if (new RegExp(a.match, "i").test(t) && (!best || a.weight > best.weight)) best = a; } catch (e) { /* bad regex never breaks scoring */ }
      }
      return best ? { key: best.key, label: best.label, weight: best.weight } : { key: "general", label: "General", weight: this.base };
    },

    /* convenience: just the multiplier. */
    weightOf: function (text, type) { return this.classify(text, type).weight; },

    /* a one-line steer for the advisor/chair prompts so the models aim where the points are heavier. */
    promptSteer: function () {
      return "PRIORITY WEIGHTING (these score MORE — hunt them first, in descending weight): " +
        areas.map(function (a) { return a.label + " ×" + a.weight; }).join("; ") +
        ". A fix in these is worth proportionally more than a general improvement.";
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = data;
  else root.priorityAreas = data;
})(typeof self !== "undefined" ? self : this);
