/* cloud/config.js — hosting switch for the Job Search OS.
 *
 * LOCAL DEV (the default below): url is empty, so hosted mode is OFF. index.html loads its static packs
 * and localStorage exactly as before — your `npm run serve` workflow is untouched.
 *
 * DEPLOY (Vercel + Supabase): set url + anonKey from your Supabase project (Settings > API). BOTH are
 * public-safe — the anon key is meant to ship to the browser, and Row-Level Security is what actually
 * protects each user's data. Set ownerEmail to your login so YOU get the QA Cockpit while other users
 * get the clean product view. No model keys ever go here (those live server-side in Vercel env).
 */
window.JSOS_CLOUD = {
  url: "",
  anonKey: "",   // Supabase publishable (public) key — safe to expose; RLS protects data
  ownerEmail: ""
};
