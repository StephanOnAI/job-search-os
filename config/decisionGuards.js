/* config/decisionGuards.js — DETERMINISTIC decision guards for the Job Search OS (UMD: browser window.* +
 * Node require). Inversion-first: rather than make scoring smarter, these pure functions make a
 * confidently-wrong output IMPOSSIBLE. They are the single source of truth for:
 *   - contact classification (a generic application email is NOT a verified named contact)
 *   - compensation tier (calibrated, final, before any recommendation)
 *   - the Priority-apply HARD GATE
 *   - JD must-have matching (never null when a JD exists; caps fit on weak matches)
 *   - a final consistency validator that downgrades any self-contradicting decision
 *
 * No DOM, no I/O, no candidate data baked in. Tested by checks/decision-guards.test.mjs.
 *
 * Recommendation labels used here: priority_apply, warm_outreach, verify_first, backup_only, reject, and
 * needs_review (the module emits needs_review when evidence integrity fails; the dashboard, which has six
 * labels, renders that as verify_first plus systemFlags — see roleDecision in index.html).
 */
(function (root) {
  // ---- 5. Contact classification ----
  function classifyContact(c) {
    c = c || {};
    var name = String(c.name || "").trim();
    var email = String(c.email || "").trim();
    var hasNamedContact = !!name;
    var hasApplicationEmail = !!email && /@/.test(email);
    var reliable = c.verificationStatus === "reliable" || c.confidence === "confirmed" || c.source === "job_ad" || c.source === "recorded";
    var hasVerifiedNamedContact = hasNamedContact && hasApplicationEmail && reliable;
    var genericApplicationEmail = hasApplicationEmail && !hasNamedContact;
    var contactStatus = "not_found";
    if (hasVerifiedNamedContact) contactStatus = "verified_named_contact";
    else if (hasNamedContact) contactStatus = "named_contact_found";   // a named recruiter (e.g. from JobStreet) but no verified email yet
    else if (genericApplicationEmail) contactStatus = "generic_application_email";
    else if (hasApplicationEmail) contactStatus = "needs_verification";
    else if (c.portalUrl) contactStatus = "portal_only";
    return { hasNamedContact: hasNamedContact, hasApplicationEmail: hasApplicationEmail, hasVerifiedNamedContact: hasVerifiedNamedContact, genericApplicationEmail: genericApplicationEmail, contactStatus: contactStatus };
  }

  // ---- 4. Compensation tier — canonical and final ----
  function compTierFinal(payMin, payMax, opts) {
    opts = opts || {}; payMin = +payMin || 0; payMax = +payMax || 0;
    if (!payMax) return "undisclosed";
    var mid = payMin ? (payMin + payMax) / 2 : payMax;
    if (mid >= 300 || (payMax > 300 && opts.strongEvidence)) return "target";
    if (mid >= 250 && payMax >= 300) return "serious";
    if (payMax >= 220) return "verify_only";
    return opts.exceptional ? "verify_only" : "low_or_reject";
  }
  // Only "target" or "serious" is genuinely pay-at-band. Every other tier (verify_only / verify-only /
  // below-floor / low_or_reject / undisclosed) is NOT at band, regardless of how payMax alone looks.
  function payAtBand(tier) { return tier === "target" || tier === "serious"; }

  // ---- 7. JD must-have matching — never null when a JD exists ----
  function jdMatch(jd, mustHaves, evidenceText) {
    if (!jd || String(jd).length < 60) return null;
    mustHaves = mustHaves || [];
    var ev = String(evidenceText || "").toLowerCase();
    var test = function (m) { return (m && m.re) ? m.re.test(ev) : ev.indexOf(String((m && m.k) || m || "").toLowerCase()) >= 0; };
    var matched = mustHaves.filter(test);
    var mustHaveMatch = mustHaves.length ? matched.length / mustHaves.length : 0;
    return {
      pct: Math.round(mustHaveMatch * 100), mustHaveMatch: mustHaveMatch,
      present: matched.map(function (m) { return (m && m.k) || m; }),
      missing: mustHaves.filter(function (m) { return !test(m); }).map(function (m) { return (m && m.k) || m; })
    };
  }
  function capFitByMustHave(fit, mustHaveMatch) {
    fit = +fit || 0;
    if (mustHaveMatch == null) return fit;
    if (mustHaveMatch < 0.40) return Math.min(fit, 55);
    if (mustHaveMatch < 0.55) return Math.min(fit, 65);
    return fit;
  }

  // ---- 6. Priority-apply hard gate ----
  function priorityApplyAllowed(ctx) {
    ctx = ctx || {};
    return ctx.evidenceIntegrity === "clean"
      && ctx.sendReady === true
      && (ctx.blockers || []).length === 0
      && payAtBand(ctx.compTier)
      && (+ctx.fitScore || 0) >= 85
      && (ctx.jdExists ? (+ctx.mustHaveMatch || 0) >= 0.70 : true)
      && ctx.hasVerifiedNamedContact === true
      && ctx.unsupportedClaims !== true
      && ctx.contradiction !== true;
  }

  // ---- 8. Final consistency validator ----
  var LOW_TIERS = { verify_only: 1, "verify-only": 1, low_or_reject: 1, "below-floor": 1, undisclosed: 1 };
  function validateDecision(o) {
    o = o || {};
    var flags = [], rec = o.recommendation;
    var hasName = o.contact ? o.contact.hasNamedContact : o.hasNamedContact;
    var hasVerified = o.contact ? o.contact.hasVerifiedNamedContact : o.hasVerifiedNamedContact;
    if (rec === "priority_apply") {
      if (o.sendReady === false) flags.push("priority_apply_with_sendReady_false");
      if ((o.blockers || []).length > 0) flags.push("priority_apply_with_blockers");
      if (LOW_TIERS[o.compTier] || !payAtBand(o.compTier)) flags.push("priority_apply_with_low_compensation");
      if (hasVerified !== true) flags.push("priority_apply_without_verified_named_contact");
    }
    if (hasName === false && /verified\s+named\s+contact/i.test(o.reasonText || "")) flags.push("verified_named_contact_wording_without_name");
    if (o.calibratedCompTier && o.compTier && o.calibratedCompTier !== o.compTier) flags.push("calibration_compTier_differs_from_decision");
    if (o.jdExists && (o.jdKeywordMatch === null || o.jdKeywordMatch === undefined)) flags.push("jd_exists_but_jdKeywordMatch_null");
    if (o.evidenceIntegrity === "failed" || o.unsupportedClaims === true) flags.push("unsupported_or_generated_claims_in_evidence");
    if (o.candidateIdMatch === false || o.runIdMatch === false) flags.push("evidence_from_different_candidate_or_run");
    if (o.actionBoardDecision && rec && o.actionBoardDecision !== rec) flags.push("actionboard_decision_mismatch");
    var critical = flags.length > 0;
    var hard = o.evidenceIntegrity === "failed" || o.unsupportedClaims === true || o.candidateIdMatch === false || o.runIdMatch === false;
    return {
      status: critical ? "failed" : "clean",
      systemFlags: flags,
      forcedRecommendation: !critical ? rec : (hard ? "needs_review" : "verify_first"),
      blockDocuments: critical
    };
  }

  var api = {
    classifyContact: classifyContact, compTierFinal: compTierFinal, payAtBand: payAtBand,
    jdMatch: jdMatch, capFitByMustHave: capFitByMustHave,
    priorityApplyAllowed: priorityApplyAllowed, validateDecision: validateDecision
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DECISION_GUARDS = api;
})(typeof window !== "undefined" ? window : globalThis);
