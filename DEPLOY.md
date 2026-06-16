# Deploy — Job Search OS

Stand up two cloud projects (about 30 minutes). Every user's data lives in Supabase behind login + Row-Level
Security, so no other user can ever see it. Login is passwordless (a magic link by email), so there is no
password to set, reset or leak.

## Steps

| # | Step | Where | Do this |
|---|------|-------|---------|
| 1 | Database | supabase.com -> New project | Region = **Singapore (Southeast Asia)**, the PDPA choice, cannot be changed later |
| 2 | Tables + security | Supabase -> SQL Editor -> New query | Paste all of **cloud/schema.sql** then Run |
| 3 | Login | Supabase -> Authentication -> Providers | Enable **Email** (magic-link is on by default) |
| 4 | Keys | Supabase -> Settings -> API | Copy **Project URL**, **anon public key**, **service_role key** (keep service_role secret) |
| 5 | Model key | console.groq.com (or NVIDIA / Gemini) | Create one free API key |
| 6 | Config | Edit **cloud/config.js** in your deploy copy only | Set **url**, **anonKey**, **ownerEmail** = your admin email |
| 7 | Deploy | vercel.com -> New Project -> import this repo | Use a PRIVATE copy if your config has real values |
| 8 | Server env vars | Vercel -> Settings -> Environment Variables | See the table below |
| 9 | Build | Vercel -> Deploy | Note the your-app.vercel.app URL |
| 10 | Login redirect | Supabase -> Authentication -> URL Configuration | Site URL = your Vercel URL |
| 11 | Live test | the deployed URL | sign in -> Add a role (try **Fetch** on a job link) -> My CV -> Export my data -> **Users** (invite yourself) -> Delete my data |

## Vercel environment variables (server-only, do NOT prefix with NEXT_PUBLIC)

| Name | Value |
|------|-------|
| **SUPABASE_URL** | your Project URL |
| **SUPABASE_SERVICE_ROLE_KEY** | the service_role key (keep secret) |
| **OWNER_EMAIL** | your admin email (this gates the owner-only **Users** page) |
| **GROQ_API_KEY** | or **NVIDIA_API_KEY** / **GEMINI_API_KEY** |

## After deploy
- Bottom-right account bar -> **Users** -> invite anyone by email. They click the emailed link to log in. No passwords.
- Each user gets their own private data (RLS). They can **Export my data** or **Delete my data** any time. A **Privacy** notice is in the same bar.

**cloud/config.js** in this public repo is intentionally blank. Set the real values in your deploy only, never commit them to a public repo.
