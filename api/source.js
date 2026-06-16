/* api/source.js — Vercel serverless: turn a pasted posting URL into a clean JD, server-side.
 *
 * v1 sourcing for the hosted app: a user pastes a posting link (or the JD text) and we return a parsed
 * { title, company, jd }. It does NOT mass-crawl — one URL per request, the same JSON-LD extraction the
 * local pipeline/fetchjd.mjs uses. Mass-scraping a job board per-user from cloud IPs gets blocked and breaks
 * the no-scrape rule, so the product asks the user to paste the role they care about.
 *
 * Env (server-only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (used only to verify the caller's session).
 */
const SB = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function htmlToText(s) {
  return String(s)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|ul|ol|div|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"').replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function extractJD(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  for (const b of blocks) {
    let j; try { j = JSON.parse(b.replace(/[\x00-\x1F]/g, " ")); } catch { continue; }
    const arr = Array.isArray(j) ? j : (j["@graph"] || [j]);
    for (const o of arr) {
      if (o && String(o["@type"]).includes("JobPosting") && o.description) {
        return { title: o.title || "", company: (o.hiringOrganization && o.hiringOrganization.name) || "", datePosted: o.datePosted || "", jd: htmlToText(o.description) };
      }
    }
  }
  return null;
}
async function verifyUser(token) {
  if (!token || !SB) return null;
  try { const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: "Bearer " + token } }); if (!r.ok) return null; const u = await r.json(); return u && u.id ? u : null; } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const user = await verifyUser((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!user) return res.status(401).json({ error: "sign in required" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const jd = String(body.jd || "").trim();
  if (jd) return res.status(200).json({ source: "pasted", title: body.title || "", company: body.company || "", jd });

  const url = String(body.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "provide a posting url or jd text" });
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (jobsearch-os jd-fetch)" }, signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) return res.status(502).json({ error: "posting fetch failed (" + r.status + ")" });
    const ex = extractJD(await r.text());
    if (!ex || !ex.jd || ex.jd.length < 120) return res.status(422).json({ error: "no JobPosting found at that link — paste the JD text instead" });
    return res.status(200).json({ source: "url", ...ex });
  } catch (e) { return res.status(502).json({ error: "could not read that link: " + (e && e.message || "error") }); }
}
