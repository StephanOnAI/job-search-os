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
    var inStyle = "width:100%;box-sizing:border-box;padding:11px 12px;border-radius:8px;border:1px solid #ffffff33;background:#ffffff14;color:#fff;margin-bottom:10px;font-size:15px";
    var linkStyle = "color:#fff;opacity:.8;text-decoration:underline;cursor:pointer;font-size:12.5px";
    gate(
      '<div style="font-size:22px;font-weight:800;margin-bottom:6px">Job Search OS</div>' +
      '<div style="opacity:.82;margin-bottom:18px">Sign in to load your cockpit.</div>' +
      '<input id="jsos-email" type="email" placeholder="you@email.com" autocomplete="email" style="' + inStyle + '"/>' +
      '<input id="jsos-pass" type="password" placeholder="password" autocomplete="current-password" style="' + inStyle + '"/>' +
      '<button id="jsos-signin" style="width:100%;padding:11px;border-radius:8px;border:0;background:#fff;color:#0f2742;font-weight:700;font-size:15px;cursor:pointer">Sign in</button>' +
      '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px">' +
        '<span id="jsos-magic" style="' + linkStyle + '">Email me a link instead</span>' +
        '<span id="jsos-forgot" style="' + linkStyle + '">Forgot password</span>' +
      '</div>' +
      '<div id="jsos-msg" style="min-height:18px;margin-top:12px;opacity:.85;font-size:13px">' + (msg || "") + '</div>'
    );
    var emailEl = document.getElementById("jsos-email"), passEl = document.getElementById("jsos-pass"),
        btn = document.getElementById("jsos-signin"), msgEl = document.getElementById("jsos-msg");
    try { var saved = localStorage.getItem("jsos_last_email"); if (saved) emailEl.value = saved; } catch (e) {}
    function emailOk(em) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em); }
    passEl.addEventListener("keydown", function (e) { if (e.key === "Enter") btn.click(); });
    emailEl.addEventListener("keydown", function (e) { if (e.key === "Enter") passEl.focus(); });
    btn.onclick = function () {
      var email = (emailEl.value || "").trim(), pass = passEl.value || "";
      if (!emailOk(email)) { msgEl.textContent = "Enter a valid email address."; return; }
      if (!pass) { msgEl.textContent = "Enter your password, or use the email link option below."; return; }
      try { localStorage.setItem("jsos_last_email", email); } catch (e) {}
      btn.disabled = true; msgEl.textContent = "Signing in…";
      sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
        btn.disabled = false;
        if (r && r.error) msgEl.textContent = "Could not sign in: " + r.error.message;
        // success -> onAuthStateChange loads the cockpit
      });
    };
    document.getElementById("jsos-magic").onclick = function () {
      var email = (emailEl.value || "").trim();
      if (!emailOk(email)) { msgEl.textContent = "Enter a valid email address first."; return; }
      try { localStorage.setItem("jsos_last_email", email); } catch (e) {}
      msgEl.textContent = "Sending…";
      sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href.split("#")[0] } })
        .then(function (r) { msgEl.textContent = (r && r.error) ? ("Could not send: " + r.error.message) : "Check your email for the sign-in link, then come back to this tab."; });
    };
    document.getElementById("jsos-forgot").onclick = function () {
      var email = (emailEl.value || "").trim();
      if (!emailOk(email)) { msgEl.textContent = "Enter your email first, then tap Forgot password."; return; }
      msgEl.textContent = "Sending a reset link…";
      sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] })
        .then(function (r) { msgEl.textContent = (r && r.error) ? ("Could not send: " + r.error.message) : "Check your email for a reset link. If your account was set up with a password already, you can just sign in with it."; });
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
      (window.IS_OWNER ? '<button id="jsos-users" style="' + btn + ';font-weight:700">Users</button>' : "") +
      '<button id="jsos-password" style="' + btn + '">Change password</button>' +
      '<button id="jsos-privacy" style="' + btn + '">Privacy</button>' +
      '<button id="jsos-export" style="' + btn + '">Export my data</button>' +
      '<button id="jsos-signout" style="' + btn + '">Sign out</button>' +
      '<button id="jsos-delete" style="border:1px solid #f0c4c4;background:#fff;border-radius:7px;padding:4px 9px;cursor:pointer;font:inherit;color:#9b2c2c">Delete my data</button>';
    if (window.IS_OWNER) { var ub = document.getElementById("jsos-users"); if (ub) ub.onclick = window.jsosUsers; }
    document.getElementById("jsos-password").onclick = function () { window.jsosChangePassword(false); };
    document.getElementById("jsos-privacy").onclick = window.jsosPrivacy;
    document.getElementById("jsos-export").onclick = window.jsosExport;
    document.getElementById("jsos-signout").onclick = window.jsosSignOut;
    document.getElementById("jsos-delete").onclick = window.jsosDeleteConfirm;
  }

  /* OWNER Users page: a table of users (email + last active), invite by email, resend their sign-in link, or
     remove them. Magic-link only — no passwords. All data comes from /api/admin (service-role, owner-gated). */
  window.jsosUsers = function () {
    if (typeof window.show === "function") return window.show("users");  // the full Users page is an owner tab now
    gate(
      '<div style="font-size:20px;font-weight:800;margin-bottom:10px">Users</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:10px">' +
      '<input id="jsos-inv-email" type="email" placeholder="invite a user by email" autocomplete="off" style="flex:1;min-width:0;padding:9px 11px;border-radius:8px;border:1px solid #ffffff33;background:#ffffff14;color:#fff;font-size:14px"/>' +
      '<button id="jsos-inv-go" style="border:0;background:#fff;color:#0f2742;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer">Invite</button></div>' +
      '<div id="jsos-users-msg" style="min-height:16px;font-size:12px;opacity:.85;margin-bottom:8px"></div>' +
      '<div id="jsos-users-tbl" style="max-height:48vh;overflow:auto;text-align:left;font-size:12.5px">Loading…</div>' +
      '<button id="jsos-users-close" style="width:100%;padding:11px;margin-top:14px;border-radius:8px;border:0;background:#fff;color:#0f2742;font-weight:700;font-size:15px;cursor:pointer">Close</button>'
    );
    document.getElementById("jsos-users-close").onclick = function () { hideGate(); };
    var msg = document.getElementById("jsos-users-msg");
    async function token() { try { return ((await sb.auth.getSession()).data.session || {}).access_token || ""; } catch (e) { return ""; } }
    async function post(body) { return fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await token()) }, body: JSON.stringify(body) }); }
    async function act(action, email, id) {
      if (action === "remove" && !confirm("Remove " + email + "? This deletes their account and all their data.")) return;
      msg.textContent = action === "remove" ? "Removing…" : "Sending link…";
      try { var r = await post({ action: action, email: email, id: id }); var d = await r.json().catch(function () { return {}; });
        msg.textContent = r.ok ? (action === "remove" ? "Removed." : "Sign-in link sent.") : (d.error || "Failed."); if (r.ok) load();
      } catch (e) { msg.textContent = "Could not reach the admin service (it runs on the deployed app)."; }
    }
    async function load() {
      var tbl = document.getElementById("jsos-users-tbl");
      try {
        var r = await fetch("/api/admin", { headers: { Authorization: "Bearer " + (await token()) } });
        var d = await r.json().catch(function () { return {}; });
        if (!r.ok) { tbl.innerHTML = '<div style="opacity:.8">' + esc(d.error || "Could not load users.") + "</div>"; return; }
        var rows = (d.users || []).map(function (u) {
          var last = u.lastActive ? new Date(u.lastActive).toISOString().slice(0, 10) : "never";
          return '<tr style="border-top:1px solid #ffffff22"><td style="padding:7px 8px">' + esc(u.email || "") + "</td>" +
            '<td style="padding:7px 8px;opacity:.8;white-space:nowrap">' + esc(last) + "</td>" +
            '<td style="padding:7px 8px;white-space:nowrap">' +
            '<button data-act="resend" data-email="' + esc(u.email) + '" style="border:1px solid #ffffff44;background:transparent;color:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px">Resend link</button> ' +
            '<button data-act="remove" data-id="' + esc(u.id) + '" data-email="' + esc(u.email) + '" style="border:1px solid #f0a0a0;background:transparent;color:#ffd2d2;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px">Remove</button></td></tr>';
        }).join("");
        tbl.innerHTML = '<table style="width:100%;border-collapse:collapse"><thead><tr style="opacity:.7;font-size:10px;text-transform:uppercase"><th style="text-align:left;padding:4px 8px">Email</th><th style="text-align:left;padding:4px 8px">Last active</th><th style="text-align:left;padding:4px 8px">Actions</th></tr></thead><tbody>' +
          (rows || '<tr><td style="padding:8px;opacity:.8">No users yet. Invite one above.</td></tr>') + "</tbody></table>";
        tbl.querySelectorAll("button[data-act]").forEach(function (b) { b.onclick = function () { act(b.getAttribute("data-act"), b.getAttribute("data-email"), b.getAttribute("data-id")); }; });
      } catch (e) { tbl.innerHTML = '<div style="opacity:.8">Could not reach the admin service (it runs on the deployed app).</div>'; }
    }
    document.getElementById("jsos-inv-go").onclick = async function () {
      var email = (document.getElementById("jsos-inv-email").value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "Enter a valid email."; return; }
      msg.textContent = "Inviting…";
      try { var r = await post({ action: "invite", email: email }); var d = await r.json().catch(function () { return {}; });
        msg.textContent = r.ok ? ("Invited " + email + ". They get a sign-in link by email.") : (d.error || "Invite failed."); if (r.ok) { document.getElementById("jsos-inv-email").value = ""; load(); }
      } catch (e) { msg.textContent = "Could not reach the admin service (it runs on the deployed app)."; }
    };
    load();
  };

  /* set or change your password. `forced` true after a reset link (PASSWORD_RECOVERY) — no Cancel, set one now.
     Also the screen a user lands on to change the temporary password the owner gave them. */
  window.jsosChangePassword = function (forced) {
    var inStyle = "width:100%;box-sizing:border-box;padding:11px 12px;border-radius:8px;border:1px solid #ffffff33;background:#ffffff14;color:#fff;margin-bottom:10px;font-size:15px";
    gate(
      '<div style="font-size:20px;font-weight:800;margin-bottom:8px">' + (forced ? "Set a new password" : "Change password") + '</div>' +
      '<div style="opacity:.85;text-align:left;font-size:13px;line-height:1.55;margin-bottom:14px">Pick a password only you know. At least 6 characters.</div>' +
      '<input id="jsos-np1" type="password" placeholder="new password" autocomplete="new-password" style="' + inStyle + '"/>' +
      '<input id="jsos-np2" type="password" placeholder="confirm new password" autocomplete="new-password" style="' + inStyle + '"/>' +
      '<button id="jsos-np-go" style="width:100%;padding:11px;border-radius:8px;border:0;background:#fff;color:#0f2742;font-weight:700;font-size:15px;cursor:pointer">Save password</button>' +
      (forced ? "" : '<button id="jsos-np-no" style="width:100%;padding:9px;margin-top:8px;border-radius:8px;border:1px solid #ffffff33;background:transparent;color:#fff;font-size:13px;cursor:pointer">Cancel</button>') +
      '<div id="jsos-np-msg" style="min-height:18px;margin-top:10px;font-size:13px;opacity:.9"></div>'
    );
    var p1 = document.getElementById("jsos-np1"), p2 = document.getElementById("jsos-np2"),
        go = document.getElementById("jsos-np-go"), no = document.getElementById("jsos-np-no"), msg = document.getElementById("jsos-np-msg");
    if (no) no.onclick = function () { if (USER) { hideGate(); } else { loginView(); } };
    go.onclick = function () {
      var a = p1.value || "", b = p2.value || "";
      if (a.length < 6) { msg.textContent = "Use at least 6 characters."; return; }
      if (a !== b) { msg.textContent = "The two passwords do not match."; return; }
      go.disabled = true; msg.textContent = "Saving…";
      sb.auth.updateUser({ password: a }).then(function (r) {
        go.disabled = false;
        if (r && r.error) { msg.textContent = "Could not save: " + r.error.message; return; }
        msg.textContent = "Password saved.";
        if (USER) { setTimeout(hideGate, 700); } else { setTimeout(function () { loginView("Password set. Sign in with it now."); }, 700); }
      });
    };
    setTimeout(function () { if (p1) p1.focus(); }, 30);
  };

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
    sb.auth.onAuthStateChange(function (evt, s) {
      if (evt === "PASSWORD_RECOVERY") { USER = s && s.user; return window.jsosChangePassword(true); }
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
