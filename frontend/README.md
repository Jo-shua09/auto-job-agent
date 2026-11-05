# Verdant frontend

The frontend is the browser-based workspace for Verdant, an AI-assisted job-search application. It is built with Next.js App Router, React, TypeScript, Tailwind CSS, and Firebase Authentication. It communicates with the FastAPI backend for profile, job-search, tailoring, application, and activity data.

## Features and pages

| Route | Purpose |
| --- | --- |
| `/` | Redirects to the agent workspace. |
| `/auth` | Sign in or create an account with Firebase Authentication. |
| `/reset-password` | Password recovery entry point. |
| `/agent` | Configure and run Scout, paste a job, and view jobs and activity. |
| `/queue` | Review tailored packages and approve applications. |
| `/history` | Browse application history. |
| `/vault` | Manage verified experience, projects, education, skills, and CV data. |
| `/settings` | Configure search preferences, limits, and appearance. |

Workspace routes are protected by the authenticated app layout. Page metadata is defined in route layouts; private app and authentication routes are marked not to be indexed. The Verdant mark, logo, and favicon are sourced from the project assets.

## Source map

```text
frontend/
├── assets/                 Original brand images
├── public/                 Static assets exposed from /
├── src/
│   ├── app/
│   │   ├── (app)/          Authenticated workspace routes and shared layout
│   │   ├── auth/            Sign-in and registration
│   │   ├── reset-password/  Password recovery route
│   │   ├── layout.tsx       Root layout and global metadata
│   │   ├── globals.css      Global styles and design tokens
│   │   └── icon.jpg         App favicon
│   ├── components/
│   │   ├── ui/              Shared UI primitives
│   │   ├── queue/           Queue-specific UI
│   │   └── ...              App shell, brand, route guard, notifications
│   ├── hooks/               Reusable React hooks
│   └── lib/                 API client, Firebase, SEO metadata, theme, utilities
├── package.json             Scripts and dependencies
└── pnpm-lock.yaml           Reproducible pnpm dependency versions
```

## Requirements

- Node.js compatible with the installed Next.js version.
- pnpm 10.x (the package declares `pnpm@10.14.0`).
- A Firebase project with Authentication enabled.
- A running Verdant API for authenticated workspace features.

## Local setup

From this directory:

```powershell
pnpm install
pnpm dev
```

Before starting the app, create `.env.local` with the variables below. Start the API separately from `../backend`; see [the backend guide](../backend/README.md). Visit [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes | Firebase web app API key. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | Firebase Authentication domain. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes | Firebase project ID. |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Yes | Firebase web app ID. |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Optional | Firebase Storage bucket if the web app needs it. |
| `NEXT_PUBLIC_API_URL` | Yes for workspace use | Absolute base URL of the FastAPI service; defaults to `http://localhost:8000` for local work. |
| `NEXT_PUBLIC_SITE_URL` | Recommended in production | Public site origin used to construct canonical and social-sharing metadata URLs. |

Firebase web configuration is used in the browser and is not a substitute for Firebase Admin service-account credentials. Do not put backend secrets, service-account JSON, Gemini keys, Serper keys, or Gmail credentials in this file or in any `NEXT_PUBLIC_` variable. Restrict the Firebase web API key to the appropriate APIs and domains in Google Cloud.

### Scripts

```bash
pnpm dev        # Start Next.js in development mode
pnpm build      # Create an optimized production build
pnpm start      # Serve the production build
pnpm typecheck  # Run TypeScript without emitting files
pnpm lint       # Run ESLint
pnpm test       # Run Vitest
```

## API connection and deployment

The client sends Firebase-authenticated requests to `NEXT_PUBLIC_API_URL`. For local development, the API normally listens on port 8000. For Vercel, set the project root to `frontend/`, configure the Firebase web variables, set `NEXT_PUBLIC_API_URL` to the deployed API origin, and set `NEXT_PUBLIC_SITE_URL` to the public frontend origin. Add the frontend origin to the backend's `FRONTEND_ORIGINS` allowlist. Redeploy after changing build-time `NEXT_PUBLIC_*` values.

An unconfigured Firebase client does not prevent static prerendering, but sign-in is unavailable until the required Firebase web configuration is added.

## Related documentation

- [Project overview and shared setup](../README.md)
- [FastAPI backend configuration and deployment](../backend/README.md)
