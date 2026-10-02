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
   - `EMERGENT_EMAIL_KEY`: required if weekly/daily email delivery uses the
     configured email provider.
   - `GOOGLE_CLIENT_ID`, `OPENAI_API_KEY`, and `OPENAI_VISION_MODEL` are
     optional and only needed when those features are enabled.
4. Deploy. The backend applies `backend/schema.sql` at startup. Register the
   production owner through the app; new stores start empty. Do not run
   `backend/seed.py` against production.

## Scheduled Reports

The weekly report is configured for Saturday at 14:30 UTC (21:30 WIB) in
`vercel.json`. Vercel Hobby cron jobs can run weekly, but their invocation time
is only precise to the hour; use Pro for minute-level timing.

The daily store-closing dispatcher runs every minute in the existing
`.emergent/crons.yml`, which Vercel does not use. Vercel Hobby does not allow
minute-level cron jobs. On Pro, add this entry to the `crons` array in
`vercel.json` if daily email reports are required:

```json
{ "path": "/api/cron/daily-store-closing", "schedule": "* * * * *" }
```

Vercel Cron invokes endpoints with `GET`; both cron endpoints support `GET` and
`POST`. Keep `CRON_SECRET` private and never add it to frontend variables.