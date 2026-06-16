/* config/contactDiscovery.js — Company Contact Discovery Layer (deterministic, source-backed, additive).
 *
 * Problem it fixes: for an EMPLOYER-posted role with no named recruiter (e.g. CYRA RENEWABLES PTE. LTD.),
 * the app used to stop at "no named contact, there is no one to email". This layer instead returns honest
 * employer-RESEARCH queries (the company's LinkedIn page) + an honest contactStatus + nextAction that points
 * to the portal. It ranks/classifies any source-backed contact that was INJECTED (e.g. a name the candidate
 * already found), but it does NOT generate a hunt for an exec to cold-contact.
 *
 * Safety contract (hard): outreach goes ONLY to the ad's named contact (CHARTER). This layer NEVER hunts for
 * an unlisted CEO / founder / MD / hiring manager to cold-email, NEVER invents a person, NEVER treats a
 * guessed or personal email as verified, NEVER sends. It only builds employer-research queries and classifies
 * INJECTED, source-backed results, so the render path stays deterministic and offline (no scraping, no
 * network, no AI here). Finding a person does NOT make a role send-ready — that gate stays with isSendReady.
 *
 * Order: runs AFTER Job Source Enrichment (pipeline/enrich.mjs) and BEFORE contact classification, the final
 * recommendation, the actionBoard and email generation. Works as a browser <script> (window.CONTACT_DISCOVERY)
 * and as a Node require(). Bump `version` when the behaviour changes.
 */
(function (root) {
  "use strict";

  /* Company without the legal-entity suffix: "CYRA RENEWABLES PTE. LTD." -> "CYRA RENEWABLES". */
  function companyShort(company) {
    return String(company || "")
      .replace(/[\s,]*\b(pte\.?\s*ltd\.?|private\s+limited|limited|ltd\.?|llp|inc\.?|corp\.?|co\.?)\s*$/i, "")
      .replace(/[\s.,]+$/, "").trim();
  }
  function isConfidential(company) {
    return !company || /confidential|undisclosed|private\s+advertiser|not\s+disclosed/i.test(String(company));
  }

  /* 1. Employer-RESEARCH queries for an employer-posted role with no named contact.
     CHARTER (hard): outreach goes ONLY to the ad's named contact. Never OSINT-profile or cold-email an
     unlisted CEO / founder / managing director / hiring manager. For an employer-posted role with no named
     contact the move is to APPLY VIA THE PORTAL; the only human touch is a peer note there sends himself
     on LinkedIn. So this returns LinkedIn RESEARCH of the employer (company page) — NOT a hunt for an exec
     to cold-contact. No CEO/founder/MD/email/UEN/exec-title queries: those target unlisted people the
     charter forbids contacting, and for a large employer (a bank, an MNC) they are also nonsensical. */
  function buildContactQueries(role, opts) {
    role = role || {}; opts = opts || {};
    // strip the portal suffix ("ACME PTE LTD — via MyCareersFuture") so research targets the real employer.
    var company = String(role.company || "").replace(/\s*[—–-]\s*via\s+.*$/i, "").trim();
    if (isConfidential(company)) return [];
    var short = companyShort(company) || company;
    var q = [];
    function push(s) { if (s && q.indexOf(s) === -1) q.push(s); }
    push('site:linkedin.com/company "' + short + '"'); // the employer's LinkedIn page (research only)
    push('"' + company + '" LinkedIn');
    return q;
  }

  /* 2/4. Email safety classification. A guessed or unknown-provenance address is NEVER "verified". */
  var GENERIC_LOCAL = /^(info|careers?|jobs?|hr|contact|admin|enquir(?:y|ies)|recruit(?:ing|ment)?|talent|hello|support|apply|applications?|people|hiring|office|general|mail)$/i;
  function classifyEmail(email, ev) {
    ev = ev || {};
    var e = String(email || "").trim().toLowerCase();
    if (!e || e.indexOf("@") === -1) return "no_email_found";
    if (ev.inferred || ev.pattern || ev.guessed) return "inferred_email_pattern";
    var local = e.split("@")[0];
    if (GENERIC_LOCAL.test(local)) return "generic_company_email";
    if (ev.publiclyListed || ev.sourceType === "company_website" || ev.sourceType === "job_posting") return "verified_work_email";
    return "inferred_email_pattern"; // unknown provenance -> never auto-send
  }

  /* 2. Contact-ladder priority (1 = best). P1 recruiter/HR tied to the posting, P2 CEO/founder/MD/country
     head, P3 functional leader for the role, P4 General Counsel / senior officer (verification lead only),
     P5 generic company contact. */
  function priorityOf(c) {
    var title = String((c && c.title) || "").toLowerCase();
    var vs = (c && c.verificationStatus) || "";
    var src = String((c && c.sourceType) || "");
    if (vs === "generic_company_contact") return 5;
    if (/recruit|talent|\bhr\b|human resources|people|hiring/.test(title) && /job_posting/.test(src)) return 1;
    if (/\bceo\b|chief executive|founder|co[- ]?founder|managing director|\bmd\b|country (head|manager|director)|\bpresident\b/.test(title)) return 2;
    if (/head of (investment|corporate finance|finance|m&a|mergers|corporate development)|chief financial|\bcfo\b|finance director|head of m&a/.test(title)) return 3;
    if (/general counsel|chief legal|company secretary|chief operating|\bcoo\b|chief\b/.test(title)) return 4;
    return 3; // a named leader of unknown function still ranks above a generic contact
  }
  /* Rank candidates by the ladder (stable: ties break on confidence, then original order). */
  function contactLadder(candidates) {
    return (candidates || []).map(function (c, i) { return { c: c, i: i }; })
      .sort(function (a, b) {
        var pa = priorityOf(a.c), pb = priorityOf(b.c);
        if (pa !== pb) return pa - pb;
        var ca = a.c.confidence || 0, cb = b.c.confidence || 0;
        if (ca !== cb) return cb - ca;
        return a.i - b.i;
      })
      .map(function (x) { return x.c; });
  }

  /* 3. Normalise an injected, source-backed result into the evidence schema + an email class. */
  function normalizeCandidate(raw) {
    raw = raw || {};
    return {
      name: String(raw.name || "").trim(),
      title: String(raw.title || "").trim(),
      company: String(raw.company || "").trim(),
      sourceUrl: raw.sourceUrl || raw.url || "",
      sourceType: raw.sourceType || "",
      evidenceText: raw.evidenceText || "",
      confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
      verificationStatus: raw.verificationStatus || "not_found",
      email: raw.email || "",
      emailClass: classifyEmail(raw.email, raw)
    };
  }

  /* A role that already names a contact in the posting: reflect it, do not search. */
  function reflectNamedContact(role, opts) {
    var portalUrl = opts.portalUrl || role.url || "";
    var emailClass = classifyEmail(opts.contactEmail, { inferred: !opts.contactEmailVerified, publiclyListed: !!opts.contactEmailVerified });
    var verified = emailClass === "verified_work_email";
    var best = {
      name: opts.namedContact, title: opts.namedTitle || "Named contact in the posting",
      company: role.company || "", sourceUrl: portalUrl, sourceType: "job_posting",
      evidenceText: "Named in the job posting.", confidence: verified ? 0.9 : 0.6,
      verificationStatus: "verified_from_job_posting"
    };
    return {
      searched: false, queries: [],
      possibleContacts: verified ? [] : [best], verifiedContacts: verified ? [best] : [],
      emailEvidence: opts.contactEmail ? [{ name: opts.namedContact, email: opts.contactEmail, classification: emailClass, sourceUrl: portalUrl, sourceType: "job_posting" }] : [],
      bestContact: best, contactStatus: verified ? "verified_named_contact" : "named_contact_no_email",
      confidence: best.confidence,
      nextAction: verified
        ? "Verified named contact with a work email. Review the draft, then send."
        : "Use LinkedIn outreach or verify company email before sending."
    };
  }

  /* 3-9. The layer for ONE role. Pure + deterministic. opts.results = injected, source-backed candidate
     contacts (empty on the live render path). Returns the companyContactDiscovery object. */
  function discoverCompanyContacts(role, opts) {
    role = role || {}; opts = opts || {};
    if (opts.namedContact && String(opts.namedContact).trim()) return reflectNamedContact(role, opts);

    var portalUrl = opts.portalUrl || role.url || "";
    var hasPortal = !!portalUrl;
    var queries = buildContactQueries(role, opts);
    var candidates = (opts.results || []).map(normalizeCandidate).filter(function (c) { return c.name; });
    var ladder = contactLadder(candidates);
    var verifiedContacts = ladder.filter(function (c) { return /^verified_from_/.test(c.verificationStatus) && c.emailClass === "verified_work_email"; });
    var possibleContacts = ladder.filter(function (c) { return verifiedContacts.indexOf(c) === -1; });
    var emailEvidence = candidates.filter(function (c) { return c.email; }).map(function (c) {
      return { name: c.name, email: c.email, classification: c.emailClass, sourceUrl: c.sourceUrl, sourceType: c.sourceType };
    });
    var genericEmail = emailEvidence.filter(function (e) { return e.classification === "generic_company_email"; })[0] || null;
    var best = verifiedContacts[0] || possibleContacts[0] || null;

    var contactStatus, nextAction, confidence = 0;
    if (best && verifiedContacts.indexOf(best) !== -1) {
      contactStatus = "verified_named_contact"; confidence = best.confidence || 0.85;
      nextAction = "Verified named contact with a work email. Review the draft, then send.";
    } else if (best) {
      confidence = best.confidence || 0.4;
      if (best.verificationStatus === "possible_linkedin_lead") {
        contactStatus = "possible_lead_needs_verification";
        nextAction = "Possible company lead found: " + best.name + (best.title ? ", " + best.title : "") + ". No verified email found. Suggested next step: LinkedIn outreach or verify email manually.";
      } else {
        contactStatus = "named_contact_no_email";
        nextAction = "Named lead found: " + best.name + (best.title ? ", " + best.title : "") + ". Use LinkedIn outreach or verify company email before sending.";
      }
    } else if (genericEmail) {
      contactStatus = "generic_application_email"; confidence = 0.3;
      nextAction = "Use generic email only if candidate approves and no better named contact is available.";
    } else if (hasPortal) {
      contactStatus = "portal_only"; confidence = 0.2;
      nextAction = "Apply via portal. No verified contact found.";
    } else {
      contactStatus = "no_contact_found"; confidence = 0;
      nextAction = "No verified named contact found in the posting. Company contact discovery checked alternate sources. No verified work email found yet.";
    }

    return {
      searched: true, queries: queries,
      possibleContacts: possibleContacts, verifiedContacts: verifiedContacts,
      emailEvidence: emailEvidence, bestContact: best,
      contactStatus: contactStatus, confidence: confidence, nextAction: nextAction
    };
  }

  var api = {
    version: "2026-06-14-research-only",
    buildContactQueries: buildContactQueries,
    classifyEmail: classifyEmail,
    contactLadder: contactLadder,
    discoverCompanyContacts: discoverCompanyContacts
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CONTACT_DISCOVERY = api;
})(typeof window !== "undefined" ? window : globalThis);
