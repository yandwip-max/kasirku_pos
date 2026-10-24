# Vercel Deployment

This repository deploys as one Vercel project with two Services: the Vite app in
`frontend/` and the FastAPI app in `backend/`. The browser and API share one
origin, so frontend requests continue to use `/api`.

## Setup

1. Import the repository into Vercel with the repository root as the project
   root. Keep the Vercel Services configuration in `vercel.json` enabled.
2. Create a new hosted PostgreSQL database for production. Do not use the local
   `127.0.0.1` URL or point the deployment at an existing database containing
   another store's records. A Supabase Session Pooler URL is supported.
3. Add these environment variables to the Vercel project:
   - `DATABASE_URL`: production PostgreSQL connection string.
   - `JWT_SECRET`: a long, random secret used to sign login tokens.
   - `CRON_SECRET`: a long, random secret; Vercel sends it as the cron
     `Authorization: Bearer ...` header.
   - `CORS_ORIGINS`: the production site origin, for example
     `https://your-project.vercel.app`.
   - `SMTP_HOST`, `SMTP_PORT` (587 or 465), `SMTP_USER`, `SMTP_PASSWORD`, and
     optionally `SMTP_FROM`: SMTP account used to send weekly/daily reports and
     the "kirim laporan" test email. For Gmail use `smtp.gmail.com`, port 587, and
     an App Password (requires 2-Step Verification). Alternatively set
     `EMERGENT_EMAIL_KEY` for the managed provider; SMTP is used first when set.
   - `GOOGLE_CLIENT_ID`, `OPENAI_API_KEY`, and `OPENAI_VISION_MODEL` are
     optional and only needed when those features are enabled.
4. Deploy. The backend applies `backend/schema.sql` at startup. Register the
   production owner through the app; new stores start empty. Do not run
   `backend/seed.py` against production.

## Scheduled Reports

The weekly report is configured for Saturday at 14:30 UTC (21:30 WIB) in
`vercel.json` and is emailed to every store's Pemilik accounts. It only sends
when `CRON_SECRET` and an email provider (`SMTP_*` or `EMERGENT_EMAIL_KEY`) are
set. Vercel Hobby cron jobs can run weekly, but their invocation time
is only precise to the hour; use Pro for minute-level timing.

## Login Email Verification

A Pemilik can switch on "Verifikasi Email saat Login" under Pengaturan Toko. After
that, every email/password login to that store returns a 6-digit code emailed to
the account (valid 10 minutes, single use, 5 attempts) and a session is issued only
after `POST /api/auth/login/verify`. It needs the same `SMTP_*` settings as the
reports and cannot be enabled while email delivery is not configured. Google
sign-in is unchanged (Google already verifies the email).

The daily store-closing dispatcher runs every minute in the existing
`.emergent/crons.yml`, which Vercel does not use. Vercel Hobby does not allow
minute-level cron jobs. On Pro, add this entry to the `crons` array in
`vercel.json` if daily email reports are required:

```json
{ "path": "/api/cron/daily-store-closing", "schedule": "* * * * *" }
```

Vercel Cron invokes endpoints with `GET`; both cron endpoints support `GET` and
`POST`. Keep `CRON_SECRET` private and never add it to frontend variables.