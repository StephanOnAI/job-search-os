/* cloud/boot.js — Hosted mode (Vercel + Supabase). ADDITIVE and OFF unless cloud/config.js has a url.
 *
 * Local dev (url empty): returns immediately — index.html loads its static packs + localStorage exactly as
 * before (verify/integrity unaffected). Hosted: gates the app behind a magic-link login, loads THIS user's
 * pack + saved state from Supabase (Row-Level Security means a user only ever sees their own rows), and keeps
 * state synced. The browser makes ZERO AI calls — the free models run server-side in /api/*.
 *
 * Loads BEFORE the pack loader, so setting window.JSOS_HOSTED here makes that loader skip the per-user
 * static files (they come from Supabase instead). The engine config/*.js still load statically.
 */
(function () {
  var C = window.JSOS_CLOUD || {};
  if (!C.url || !C.anonKey) return;                 // not configured -> LOCAL mode, nothing changes
  // Hosted mode is ONLY for the public deploy domain. Stay LOCAL (static packs + localStorage, as before) for
  // file:// (verify/integrity), localhost / LAN / Tailscale (his own use + phone over Tailscale) even when the
  // deploy config is filled in — otherwise opening the file or serving on :5500 would skip the data and show a
  // login gate. Set window.JSOS_FORCE_HOSTED = true before this script to test hosted mode locally.
  var h = location.hostname || "";
  var isLocal = location.protocol === "file:" || h === "" || h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0"
    || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)   // Tailscale CGNAT 100.64.0.0/10
    || /\.local$/.test(h);
  if (isLocal && !window.JSOS_FORCE_HOSTED) return;  // local / dev / verify / phone-over-Tailscale -> hosted OFF
  window.JSOS_HOSTED = true;                         // the pack loader checks this synchronously

  // the synchronous app (first paint runs renderRoles() before our async data arrives) must not crash
  window.ROLES = window.ROLES || [];
  window.JDS = window.JDS || {};
  window.CONTACTS = window.CONTACTS || {};
  window.RECRUITERS = window.RECRUITERS || [];

  var sb = null, USER = null;

  /* full-screen navy gate (matches the cockpit palette; an additive screen, not a redesign of any panel) */
  function gate(html) {
    var g = document.getElementById("jsos-gate");
    if (!g) {
      g = document.createElement("div"); g.id = "jsos-gate";
      g.setAttribute("style", "position:fixed;inset:0;z-index:2147483646;background:#0f2742;color:#fff;display:flex;align-items:center;justify-content:center;font:15px/1.5 system-ui,'Segoe UI',Arial;padding:20px");
      (document.body || document.documentElement).appendChild(g);
    }
    g.innerHTML = '<div style="max-width:360px;width:100%;text-align:center">' + html + '</div>';
    return g;
  }
  function hideGate() { var g = document.getElementById("jsos-gate"); if (g) g.parentNode.removeChild(g); }
  gate('<div style="font-size:18px;font-weight:700">Loading…</div>');   // cover the screen from the first moment

  function loginView(msg) {
    gate(
      '<div style="font-size:22px;font-weight:800;margin-bottom:6px">Job Search OS</div>' +
      '<div style="opacity:.82;margin-bottom:18px">Sign in to load your cockpit.</div>' +
      '<input id="jsos-email" type="email" placeholder="you@email.com" autocomplete="email" ' +
        'style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:8px;border:1px solid #ffffff33;background:#ffffff14;color:#fff;margin-bottom:10px;font-size:15px"/>' +
      '<button id="jsos-send" style="width:100%;padding:11px;border-radius:8px;border:0;background:#fff;color:#0f2742;font-weight:700;font-size:15px;cursor:pointer">Email me a sign-in link</button>' +
      '<div id="jsos-msg" style="min-height:18px;margin-top:12px;opacity:.85;font-size:13px">' + (msg || "") + '</div>'
    );
    var emailEl = document.getElementById("jsos-email"), btn = document.getElementById("jsos-send"), msgEl = document.getElementById("jsos-msg");
    try { var saved = localStorage.getItem("jsos_last_email"); if (saved) emailEl.value = saved; } catch (e) {}
    emailEl.addEventListener("keydown", function (e) { if (e.key === "Enter") btn.click(); });
    btn.onclick = function () {
      var email = (emailEl.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msgEl.textContent = "Enter a valid email address."; return; }
      try { localStorage.setItem("jsos_last_email", email); } catch (e) {}
      btn.disabled = true; msgEl.textContent = "Sending…";
      sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href.split("#")[0] } })
        .then(function (r) { btn.disabled = false; msgEl.textContent = (r && r.error) ? ("Could not send: " + r.error.message) : "Check your email for the sign-in link, then come back to this tab."; });
    };
  }

  /* PDPA consent on first sign-in (a brand-new user with no profile row yet). Plain, secular, no nagging. */
  function consentGate() {
    return new Promise(function (resolve) {
      gate(
        '<div style="font-size:20px;font-weight:800;margin-bottom:10px">Before we start</div>' +
        '<div style="opacity:.86;text-align:left;font-size:13.5px;line-height:1.6;margin-bottom:16px">' +
          'Job Search OS saves the roles and notes you add so your list is here next time. Your data is private to your login, Singapore-hosted, and is never shared or sold. You can export or delete it any time.' +
        '</div>' +
        '<label style="display:flex;gap:8px;align-items:flex-start;text-align:left;font-size:13px;margin-bottom:14px;cursor:pointer">' +
          '<input id="jsos-consent-cb" type="checkbox" style="margin-top:3px"/> <span>I agree to store my data for my own job search.</span></label>' +
        '<button id="jsos-consent-go" disabled style="width:100%;padding:11px;border-radius:8px;border:0;background:#fff;color:#0f2742;font-weight:700;font-size:15px;cursor:pointer;opacity:.5">Continue</button>' +
        '<button id="jsos-consent-no" style="width:100%;padding:9px;margin-top:8px;border-radius:8px;border:1px solid #ffffff33;background:transparent;color:#fff;font-size:13px;cursor:pointer">Not now</button>'
      );
      var cb = document.getElementById("jsos-consent-cb"), go = document.getElementById("jsos-consent-go"), no = document.getElementById("jsos-consent-no");
      cb.onchange = function () { go.disabled = !cb.checked; go.style.opacity = cb.checked ? "1" : ".5"; };
      go.onclick = function () { if (cb.checked) resolve(true); };
      no.onclick = function () { resolve(false); };
    });
  }

  /* replay the saved pack onto the window globals the app reads (window.ROLES, JDS, CONTACTS, RECRUITERS,
     CV_TEXT, JS_PROFILE, …) — captured generically by the seed script, so new globals never need new code. */
  function applyPack(pack) {
    if (!pack || typeof pack !== "object") return;
    Object.keys(pack).forEach(function (k) { try { window[k] = pack[k]; } catch (e) {} });
  }

  function repaint() {
    ["renderRoles", "renderRecs", "renderLearn", "renderEdge", "renderTracker", "renderOutreach"].forEach(function (fn) {
      try { if (typeof window[fn] === "function") window[fn](); } catch (e) {}
    });
    try { if (typeof window.show === "function") window.show("outreach"); } catch (e) {}
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* account control (bottom-right) once signed in: who you are + your data rights (PDPA/GDPR): read the privacy
     notice, export your data (access/portability), sign out, delete everything. */
  function accountBar() {
    var bar = document.getElementById("jsos-acct");
    if (!bar) {
      bar = document.createElement("div"); bar.id = "jsos-acct";
      bar.setAttribute("style", "position:fixed;right:12px;bottom:12px;z-index:2147483640;display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end;max-width:min(94vw,460px);background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:6px 10px;box-shadow:0 6px 22px rgba(15,23,42,.16);font:12px system-ui,'Segoe UI',Arial");
      document.body.appendChild(bar);
    }
    var btn = "border:1px solid #e2e8f0;background:#fff;border-radius:7px;padding:4px 9px;cursor:pointer;font:inherit;color:#1f3a5f";
    bar.innerHTML = '<span style="color:#5a6b80;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(USER.email || "Signed in") + "</span>" +
      '<button id="jsos-privacy" style="' + btn + '">Privacy</button>' +
      '<button id="jsos-export" style="' + btn + '">Export my data</button>' +
      '<button id="jsos-signout" style="' + btn + '">Sign out</button>' +
      '<button id="jsos-delete" style="border:1px solid #f0c4c4;background:#fff;border-radius:7px;padding:4px 9px;cursor:pointer;font:inherit;color:#9b2c2c">Delete my data</button>';
    document.getElementById("jsos-privacy").onclick = window.jsosPrivacy;
    document.getElementById("jsos-export").onclick = window.jsosExport;
    document.getElementById("jsos-signout").onclick = window.jsosSignOut;
    document.getElementById("jsos-delete").onclick = window.jsosDeleteConfirm;
  }

  /* the privacy notice (PDPA/GDPR right to be informed): what, why, where, how long, your rights, contact. */
  window.jsosPrivacy = function () {
    gate(
      '<div style="font-size:20px;font-weight:800;margin-bottom:10px">Privacy and your data</div>' +
      '<div style="opacity:.92;text-align:left;font-size:13px;line-height:1.65;max-height:58vh;overflow:auto;padding-right:4px">' +
      '<p style="margin:0 0 10px"><b>What we store:</b> only what you add, the roles you are chasing, your CV text, your notes and application status. We never scrape, buy or sell data.</p>' +
      '<p style="margin:0 0 10px"><b>Why:</b> to score your fit, prepare your applications and track follow-ups. Nothing is ever sent on your behalf, you do that yourself.</p>' +
      '<p style="margin:0 0 10px"><b>Where:</b> a Singapore-region database, private to your login. Row-level security means no other user can ever see your data.</p>' +
      '<p style="margin:0 0 10px"><b>How long:</b> only while your account is active. Delete it any time and it is gone.</p>' +
      '<p style="margin:0 0 10px"><b>Your rights:</b> access and export your data any time (Export my data), and erase all of it any time (Delete my data), both in the account bar.</p>' +
      '<p style="margin:0"><b>Contact:</b> the app owner, at the email address you signed up through.</p>' +
      '</div>' +
      '<button id="jsos-priv-ok" style="width:100%;padding:11px;margin-top:14px;border-radius:8px;border:0;background:#fff;color:#0f2742;font-weight:700;font-size:15px;cursor:pointer">Close</button>'
    );
    document.getElementById("jsos-priv-ok").onclick = function () { hideGate(); };
  };

  /* export my data (PDPA/GDPR right of access + portability): download everything we hold for this user as JSON. */
  window.jsosExport = function () {
    var data = { exportedAt: new Date().toISOString(), account: { email: USER && USER.email }, profile: {}, state: {} };
    ["ROLES", "JDS", "CONTACTS", "RECRUITERS", "CV_TEXT", "JS_PROFILE"].forEach(function (k) { if (typeof window[k] !== "undefined") data.profile[k] = window[k]; });
    try { for (var i = 0; i < localStorage.length; i++) { var key = localStorage.key(i); if (/^jsos_/.test(key)) { try { data.state[key] = JSON.parse(localStorage.getItem(key)); } catch (e) { data.state[key] = localStorage.getItem(key); } } } } catch (e) {}
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "my-job-search-data-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };

  window.jsosSignOut = function () {
    try { sb.auth.signOut(); } catch (e) {}
    try { localStorage.clear(); } catch (e) {}
    location.reload();
  };

  /* delete-my-data: typed confirmation, then erase this user's rows under RLS + (best-effort) the auth login
     itself via /api/delete-account, sign out and clear local. Irreversible, so it asks the user to type DELETE. */
  window.jsosDeleteConfirm = function () {
    gate(
      '<div style="font-size:20px;font-weight:800;margin-bottom:8px">Delete everything?</div>' +
      '<div style="opacity:.86;text-align:left;font-size:13.5px;line-height:1.6;margin-bottom:14px">This permanently removes your roles, notes and saved state from the server and signs you out. It cannot be undone.</div>' +
      '<input id="jsos-del-in" placeholder="Type DELETE to confirm" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #ffffff33;background:#ffffff14;color:#fff;margin-bottom:10px;font-size:15px"/>' +
      '<button id="jsos-del-go" style="width:100%;padding:11px;border-radius:8px;border:0;background:#e23b3b;color:#fff;font-weight:700;font-size:15px;cursor:pointer">Delete my data</button>' +
      '<button id="jsos-del-no" style="width:100%;padding:9px;margin-top:8px;border-radius:8px;border:1px solid #ffffff33;background:transparent;color:#fff;font-size:13px;cursor:pointer">Keep my data</button>' +
      '<div id="jsos-del-msg" style="min-height:18px;margin-top:10px;font-size:13px;opacity:.9"></div>'
    );
    var inp = document.getElementById("jsos-del-in"), go = document.getElementById("jsos-del-go"), no = document.getElementById("jsos-del-no"), msg = document.getElementById("jsos-del-msg");
    no.onclick = function () { hideGate(); };
    go.onclick = async function () {
      if ((inp.value || "").trim().toUpperCase() !== "DELETE") { msg.textContent = "Type DELETE to confirm."; return; }
      go.disabled = true; msg.textContent = "Deleting…";
      try {
        await sb.from("app_state").delete().eq("owner", USER.id);
        await sb.from("profiles").delete().eq("owner", USER.id);
        try {
          var sess = (await sb.auth.getSession()).data.session;
          if (sess) await fetch("/api/delete-account", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + sess.access_token } });
        } catch (e) { /* endpoint optional — the data rows above are already gone */ }
        try { await sb.auth.signOut(); } catch (e) {}
        try { localStorage.clear(); } catch (e) {}
        gate('<div style="font-size:18px;font-weight:700">Your data has been deleted. Thank you.</div>');
        setTimeout(function () { location.reload(); }, 1800);
      } catch (e) { go.disabled = false; msg.textContent = "Could not delete: " + ((e && e.message) || e) + ". Please try again."; }
    };
    setTimeout(function () { if (inp) inp.focus(); }, 30);
  };

  async function loadAndRender() {
    gate('<div style="font-size:18px;font-weight:700">Loading your cockpit…</div>');
    window.IS_OWNER = !!(USER.email && C.ownerEmail && USER.email.toLowerCase() === String(C.ownerEmail).toLowerCase());
    window.DEV_VIEW = window.IS_OWNER;
    window.JS_PROFILES = [{ id: "me", name: USER.email || "You", dir: "", owner: window.IS_OWNER }];
    window.ACTIVE_PROFILE = window.JS_PROFILES[0]; window.PROFILE_DIR = "";

    var prof = null;
    try { prof = await sb.from("profiles").select("pack,name,consent_at").eq("owner", USER.id).maybeSingle(); }
    catch (e) { console.warn("[cloud] profile load failed:", e && e.message); }
    if (!prof || !prof.data) {                       // brand-new user -> PDPA consent before we store anything
      var agreed = await consentGate();
      if (!agreed) { try { await sb.auth.signOut(); } catch (e) {} USER = null; loginView("Signed out. Come back any time."); return; }
      gate('<div style="font-size:18px;font-weight:700">Setting up…</div>');
      try { await sb.from("profiles").insert({ owner: USER.id, email: USER.email, name: USER.email, is_owner: window.IS_OWNER, secular: true, consent_at: new Date().toISOString() }); }
      catch (e) { console.warn("[cloud] profile create failed:", e && e.message); }
      prof = { data: { name: USER.email } };
    }
    if (prof.data.pack) applyPack(prof.data.pack);
    if (prof.data.name) window.JS_PROFILES[0].name = prof.data.name;

    try {
      var st = await sb.from("app_state").select("key,value").eq("owner", USER.id);
      (st && st.data || []).forEach(function (row) { try { localStorage.setItem(row.key, JSON.stringify(row.value)); } catch (e) {} });
    } catch (e) { console.warn("[cloud] state load failed:", e && e.message); }

    /* state push: mirror the local serve-sync (debounced), but to Supabase. setStore() calls this. */
    var dirty = {}, t = null;
    window.cloudPushState = function (k) {
      try { dirty[k] = JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return; }
      clearTimeout(t); t = setTimeout(flush, 500);
    };
    function flush() {
      var keys = Object.keys(dirty); if (!keys.length) return;
      var rows = keys.map(function (k) { return { owner: USER.id, key: k, value: dirty[k], updated_at: new Date().toISOString() }; });
      dirty = {};
      sb.from("app_state").upsert(rows, { onConflict: "owner,key" }).then(function () {}, function (e) { console.warn("[cloud] state push failed:", e && e.message); });
    }
    window.JSOS_SB = sb; window.JSOS_USER = USER;   // exposed for /api callers (Authorization) and diagnostics

    hideGate();
    repaint();
    accountBar();
  }

  function signedIn(session) { return session && session.user; }

  function start() {
    sb = window.supabase.createClient(C.url, C.anonKey);
    sb.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (signedIn(s)) { USER = s.user; loadAndRender(); } else { loginView(); }
    });
    sb.auth.onAuthStateChange(function (_evt, s) {
      if (signedIn(s) && (!USER || USER.id !== s.user.id)) { USER = s.user; loadAndRender(); }
    });
  }

  function boot() {
    if (window.supabase && window.supabase.createClient) return start();
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = start;
    s.onerror = function () { gate('<div>Could not load the sign-in library. Check your connection and reload.</div>'); };
    (document.head || document.documentElement).appendChild(s);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
