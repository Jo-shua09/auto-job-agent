# Verdant frontend

The frontend is the browser workspace for Verdant, an AI-assisted job-search application. It uses Next.js App Router, React, TypeScript, Tailwind CSS, Google Identity Services for Google sign-in, and a Verdant-issued bearer token for authenticated API requests.

## Features and pages

| Route | Purpose |
| --- | --- |
| `/` | Redirects to the agent workspace. |
| `/auth` | Create an account or sign in with email/password or Google. |
| `/reset-password` | Placeholder route; email password recovery is not available yet. |
| `/agent` | Configure and run Scout, paste a job, and view jobs and activity. |
| `/queue` | Review tailored packages and approve applications. |
| `/history` | Browse application history. |
| `/vault` | Manage experience, projects, education, skills, and CV data. |
| `/settings` | Configure job-search preferences, limits, and appearance. |

Private workspace routes are protected by a backend-verified session. The Verdant logo, favicon, page metadata, and SEO configuration are maintained in the frontend.

## Source map

```text
frontend/
├── assets/                 Original brand images
├── public/                 Static assets exposed from /
├── src/
│   ├── app/
│   │   ├── (app)/          Authenticated workspace pages and shared layout
│   │   ├── auth/            Sign-in and registration page
│   │   ├── reset-password/  Password recovery placeholder
│   │   ├── layout.tsx       Root layout and global metadata
│   │   └── globals.css      Global styles and design tokens
│   ├── components/         App shell, route guard, and UI components
│   ├── hooks/               Reusable React hooks
│   └── lib/
│       ├── api.ts           API requests and error handling
│       ├── auth.ts          Token storage, auth calls, and session events
│       ├── theme.ts         Theme state
│       └── ...              Other shared utilities
├── package.json
└── pnpm-lock.yaml
```

## Requirements and local setup

- Node.js compatible with the project's Next.js release.
- pnpm 10.x (the package declares `pnpm@10.14.0`).
- A running Verdant backend and MongoDB database.
- A Google OAuth web client ID if Google sign-in is required.

Create `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<Google-OAuth-web-client-id>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then run from this directory:

```powershell
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The OAuth client must list `http://localhost:3000` as an authorized JavaScript origin. See [the backend guide](../backend/README.md) for Atlas and API setup.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Yes for workspace use | Absolute base URL of the FastAPI service; defaults to `http://localhost:8000` locally. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Required for Google sign-in | Public OAuth web client ID. This is not a private secret. It must match backend `GOOGLE_CLIENT_ID`. |
| `NEXT_PUBLIC_SITE_URL` | Recommended in production | Public site origin used for canonical and social-sharing metadata URLs. |

Do not add `MONGODB_URI`, `AUTH_JWT_SECRET`, Gemini/Search provider keys, database passwords, or other backend credentials to frontend environment variables. Anything prefixed `NEXT_PUBLIC_` is included in client-side code.

## Scripts

```bash
pnpm dev        # Start Next.js in development mode
pnpm build      # Create an optimized production build
pnpm start      # Serve the production build
pnpm typecheck  # Run TypeScript without emitting files
pnpm lint       # Run ESLint
pnpm test       # Run Vitest
```

## Deploy to Vercel

Set the Vercel project root to `frontend/`, then configure:

```text
NEXT_PUBLIC_API_URL=<Render API origin>
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<Google OAuth web client ID>
NEXT_PUBLIC_SITE_URL=https://verdant-agent.vercel.app
```

In the backend's Render environment, set `FRONTEND_ORIGINS=https://verdant-agent.vercel.app`. Add the Vercel origin to the Google OAuth client as an authorized JavaScript origin. Redeploy Vercel after changing any `NEXT_PUBLIC_*` variable.

The browser stores the Verdant JWT in local storage and sends it as a bearer token to the API. Sign-out removes the local session; tokens expire after seven days. The backend does not provide password-reset email delivery yet, so the existing reset-password route is informational rather than a working recovery flow.

See the [project overview](../README.md) and [backend guide](../backend/README.md).
