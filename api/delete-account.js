/* api/delete-account.js — Vercel serverless: a signed-in user erases their OWN account (PDPA "delete my data").
 *
 * The browser already deletes the user's data rows under Row-Level Security. This endpoint also removes the
 * login (auth user) itself, which only the service role can do, so erasure is complete. It verifies the
 * caller's Supabase session first, then deletes only THAT user's rows + auth record. No model, no PII logged.
 *
 * Env (Vercel project settings, server-only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
const SB = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function verifyUser(token) {
  if (!token || !SB) return null;
  try {
    const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: "Bearer " + token } });
    if (!r.ok) return null;
    const u = await r.json(); return u && u.id ? u : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!SB || !SERVICE) return res.status(500).json({ error: "server not configured" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = await verifyUser(token);
  if (!user) return res.status(401).json({ error: "not signed in" });

  const h = { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" };
  try {
    // delete the user's data first (defensive — the client also does this under RLS), then the auth user
    await fetch(`${SB}/rest/v1/app_state?owner=eq.${user.id}`, { method: "DELETE", headers: h });
    await fetch(`${SB}/rest/v1/profiles?owner=eq.${user.id}`, { method: "DELETE", headers: h });
    const del = await fetch(`${SB}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: h });
    return res.status(200).json({ ok: true, authDeleted: del.ok });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
