/* api/admin.js — Vercel serverless: the OWNER's user-management endpoint (the Users page).
 *
 * OWNER ONLY. It verifies the caller's Supabase session AND that the caller is the configured owner, then
 * uses the service role to: list users, invite a new user by email (sends them a sign-in link), resend that
 * link, or remove a user. No passwords anywhere — sign-in is magic-link, so "invite" / "resend" just email a
 * link the user clicks to log in. No model, no PII logged.
 *
 * Env (Vercel project settings, server-only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_EMAIL.
 */
const SB = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OWNER = (process.env.OWNER_EMAIL || "").toLowerCase();

/* a readable temp password the owner can pass on by message (no ambiguous chars). The user changes it after. */
function tempPassword() {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; for (let i = 0; i < 4; i++) s += cs[Math.floor(Math.random() * cs.length)];
  return s + "-" + Math.floor(1000 + Math.random() * 9000);   // e.g. Kp7m-4821
}

async function caller(token) {
  if (!token || !SB) return null;
  try {
    const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: "Bearer " + token } });
    if (!r.ok) return null;
    const u = await r.json(); return u && u.id ? u : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (!SB || !SERVICE) return res.status(500).json({ error: "server not configured" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const me = await caller(token);
  if (!me) return res.status(401).json({ error: "sign in required" });
  if (OWNER && (me.email || "").toLowerCase() !== OWNER) return res.status(403).json({ error: "owner only" });

  const h = { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" };
  const redirect = "https://" + (req.headers.host || "") + "/";
  const action = (req.method === "GET" ? "list" : ((req.body && req.body.action) || "list"));

  try {
    if (action === "list") {
      const r = await fetch(`${SB}/auth/v1/admin/users?per_page=200`, { headers: h });
      const d = await r.json();
      const users = (d.users || d || []).map(u => ({
        id: u.id, email: u.email,
        joined: u.created_at || null, lastActive: u.last_sign_in_at || null,
        confirmed: !!(u.email_confirmed_at || u.confirmed_at),
      }));
      return res.status(200).json({ users });
    }
    const email = ((req.body && req.body.email) || "").trim().toLowerCase();
    if (action === "create") {
      // create a confirmed account WITH a temporary password and hand it back to the owner to pass on, so NO
      // email needs to be delivered (the owner tells the user their login out of band, they change it after).
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "valid email required" });
      const pw = tempPassword();
      const r = await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: h, body: JSON.stringify({ email, password: pw, email_confirm: true }) });
      if (r.status === 422) return res.status(409).json({ error: "that email already has an account (use Reset password instead)" });
      if (!r.ok) return res.status(502).json({ error: "could not create the login (" + r.status + ")" });
      return res.status(200).json({ ok: true, action: "created", email, password: pw });
    }
    if (action === "reset") {
      // owner-driven password reset: set a fresh temporary password on an existing user, return it to the owner.
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "valid email required" });
      const find = await fetch(`${SB}/auth/v1/admin/users?per_page=200`, { headers: h });
      const fd = await find.json(); const u = (fd.users || fd || []).find(x => (x.email || "").toLowerCase() === email);
      if (!u) return res.status(404).json({ error: "no account for that email" });
      const pw = tempPassword();
      const r = await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: "PUT", headers: h, body: JSON.stringify({ password: pw }) });
      if (!r.ok) return res.status(502).json({ error: "could not reset the password (" + r.status + ")" });
      return res.status(200).json({ ok: true, action: "reset", email, password: pw });
    }
    if (action === "invite" || action === "resend") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "valid email required" });
      // sends the user a sign-in (magic) link; works for a brand-new invite or a re-send
      const r = await fetch(`${SB}/auth/v1/invite`, { method: "POST", headers: h, body: JSON.stringify({ email, options: { redirectTo: redirect } }) });
      if (!r.ok && r.status === 422) { // already exists -> send a fresh magic link instead
        const r2 = await fetch(`${SB}/auth/v1/otp`, { method: "POST", headers: h, body: JSON.stringify({ email, create_user: false, options: { redirectTo: redirect } }) });
        if (!r2.ok) return res.status(502).json({ error: "could not resend the link" });
        return res.status(200).json({ ok: true, action: "resent" });
      }
      if (!r.ok) return res.status(502).json({ error: "invite failed (" + r.status + ")" });
      return res.status(200).json({ ok: true, action: "invited" });
    }
    if (action === "remove") {
      const id = (req.body && req.body.id) || "";
      if (!id) return res.status(400).json({ error: "user id required" });
      const del = await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: h });
      return res.status(del.ok ? 200 : 502).json({ ok: del.ok });
    }
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
