/* api/review.js — Vercel serverless: an OPTIONAL "AI second opinion" on one role, on a FREE model.
 *
 * This is the ONLY place the hosted app touches a model — the browser never holds a key, so the "no AI on
 * render" rule still holds (this runs only when a signed-in user clicks the button). It verifies the
 * Supabase session, caches every result in review_cache (a no-change re-ask costs nothing), and on any
 * rate-limit / missing-key it returns source:"deterministic" so the client uses its built-in deterministic
 * verdict instead. Free providers, first one whose key is set wins.
 *
 * Env (Vercel project settings, server-only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and at least one of
 * GROQ_API_KEY, NVIDIA_API_KEY, GEMINI_API_KEY.
 */
import { createHash } from "node:crypto";

const SB = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const PROVIDERS = [
  { key: "GROQ_API_KEY",   url: "https://api.groq.com/openai/v1/chat/completions",            model: "llama-3.3-70b-versatile" },
  { key: "NVIDIA_API_KEY", url: "https://integrate.api.nvidia.com/v1/chat/completions",       model: "meta/llama-3.1-70b-instruct" },
  { key: "GEMINI_API_KEY", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-1.5-flash" },
];

async function verifyUser(token) {
  if (!token || !SB) return null;
  try {
    const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: "Bearer " + token } });
    if (!r.ok) return null;
    const u = await r.json(); return u && u.id ? u : null;
  } catch { return null; }
}
async function cacheGet(k) {
  try {
    const r = await fetch(`${SB}/rest/v1/review_cache?cache_key=eq.${encodeURIComponent(k)}&select=result`, { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE } });
    if (!r.ok) return null; const rows = await r.json(); return rows[0] ? rows[0].result : null;
  } catch { return null; }
}
async function cachePut(k, model, result) {
  try {
    await fetch(`${SB}/rest/v1/review_cache?on_conflict=cache_key`, {
      method: "POST",
      headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ cache_key: k, model, result }]),
    });
  } catch { /* cache is best-effort */ }
}
async function callModel(messages) {
  for (const p of PROVIDERS) {
    const apiKey = process.env[p.key]; if (!apiKey) continue;
    try {
      const r = await fetch(p.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({ model: p.model, messages, temperature: 0.2, max_tokens: 700 }),
      });
      if (!r.ok) continue;                       // rate-limited / unavailable -> try the next free provider
      const j = await r.json();
      const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (text) return { text, model: p.model };
    } catch { /* try next */ }
  }
  return null;                                   // no provider available -> caller falls back to deterministic
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = await verifyUser(token);
  if (!user) return res.status(401).json({ error: "sign in required" });

  const role = body.role || {}, jd = String(body.jd || "").slice(0, 8000);
  const slim = { title: role.role || role.title || "", company: role.company || "", pay: [role.payMin, role.payMax], jd };
  const cacheKey = createHash("sha256").update(JSON.stringify(slim)).digest("hex");

  const cached = await cacheGet(cacheKey);
  if (cached) return res.status(200).json({ source: "cache", ...cached });

  const messages = [
    { role: "system", content: "You are a candid senior finance recruiter. In 4-6 sentences, give an honest read on fit for THIS candidate (a regional finance and operations leader, CA/CPA), the single biggest risk, and one concrete next step. No flattery, no buzzwords, no em dashes." },
    { role: "user", content: `ROLE: ${slim.title} at ${slim.company}\nPAY (SGD k): ${slim.pay.join("-")}\n\nJD:\n${jd || "(not provided)"}` },
  ];
  const out = await callModel(messages);
  if (!out) return res.status(200).json({ source: "deterministic" });   // client shows its own deterministic verdict

  const result = { verdict: out.text.trim(), model: out.model, at: new Date().toISOString() };
  await cachePut(cacheKey, out.model, result);
  return res.status(200).json({ source: "model", ...result });
}
