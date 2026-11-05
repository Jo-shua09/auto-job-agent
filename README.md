# Verdant

Verdant is an AI-assisted job-search workspace. It helps a user discover roles that match their preferences, prepare application materials from career information they have supplied, and track the application process. Users can review and edit a tailored application package before approving it for submission.

The project is split into a Next.js web application and a FastAPI service. Firebase Authentication identifies users, and Firebase Admin/Firestore stores per-user profile, preference, and job workflow data. Gemini supports selected AI workflows; job search providers and Gmail integration are configured separately.

## What the app does

- **Build a verified career profile:** maintain experience, projects, education, skills, and application details in the Vault, or upload a CV for parsing.
- **Configure a search:** choose target roles, locations, work modes, match preferences, and daily application limits.
- **Find and prepare jobs:** run the Scout or paste a job URL/job description to create a tailored application package.
- **Review before applying:** inspect the match, tailored CV, cover letter, and screening answers; edit the package and approve it.
- **Track activity:** view application history, current job states, agent activity, and any requested one-time verification codes.

The app is not a public job board. A new account starts with a blank profile and search settings. AI-generated application content is intended to be grounded in the user's supplied career information; users should review all material before approving an application.

## Repository map

```text
.
├── README.md                     Project overview and shared setup
├── backend/
│   ├── README.md                 API setup, configuration, and deployment
│   ├── requirements.txt          Python dependencies
│   ├── app/
│   │   ├── main.py               FastAPI app, middleware, and HTTP routes
│   │   ├── core/                 Firebase, Firestore, and runtime setup
│   │   ├── models/               Pydantic request/domain schemas
│   │   ├── routers/              Reserved for route modules (routes currently live in main.py)
│   │   └── services/             Auth, profiles, scouting, tailoring, applying, inbox, PDFs, job states
│   ├── credentials/              Local Firebase service-account files; do not commit
│   └── generated_pdfs/           Generated application PDFs; runtime output
└── frontend/
    ├── README.md                 Web app setup, routes, and configuration
    ├── assets/                   Source branding artwork
    ├── public/                   Static files served from the site root
    └── src/
        ├── app/                  Next.js App Router pages, layouts, metadata, styles, and icons
        ├── components/           Shared app shell, brand, route guard, and UI components
        ├── hooks/                Reusable React hooks
        └── lib/                  API client, Firebase client, theme, and shared utilities
```

Generated files, local dependency folders, and credentials are intentionally not part of the application source. See the [backend guide](./backend/README.md) for credential setup and the [frontend guide](./frontend/README.md) for web configuration.

## Run locally

You need Node.js with pnpm, Python, a Firebase project, and the credentials/API keys for the integrations you plan to use. Never commit `.env` files, service-account JSON, API keys, or generated personal application documents.

### 1. Configure and run the backend

From `backend/`, create a local `.env` using the variable names in [backend/README.md](./backend/README.md). Provide Firebase Admin credentials either with a local service-account file or `FIREBASE_SERVICE_ACCOUNT_JSON`. Install dependencies and start the API:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The API health endpoint is [http://localhost:8000/health](http://localhost:8000/health); interactive API documentation is at [http://localhost:8000/docs](http://localhost:8000/docs).

### 2. Configure and run the frontend

From `frontend/`, create `.env.local` with the Firebase **web app** configuration and API URL described in [frontend/README.md](./frontend/README.md). Then install packages and start Next.js:

```powershell
cd frontend
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Set the backend's `FRONTEND_ORIGINS` to the exact origin(s) where the frontend runs. When testing from another device, use an API address reachable from that device instead of `localhost`.

## Deployments

- **Frontend:** deploy the `frontend/` directory as the Vercel project root. Add the required `NEXT_PUBLIC_FIREBASE_*` web configuration variables, `NEXT_PUBLIC_API_URL` pointing to the deployed API, and `NEXT_PUBLIC_SITE_URL` for the public site origin. Redeploy after changing environment variables.
- **Backend:** deploy `backend/` as the Render service root. Install from `requirements.txt`, run `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, and configure Firebase Admin credentials plus the service's required integration variables in Render's environment settings. Add the deployed frontend origin to `FRONTEND_ORIGINS`.

See each subproject README for complete setup, configuration, service details, and validation commands.

## Security and privacy

- Keep Firebase Admin service-account credentials and all provider API keys server-side. Do not use a `NEXT_PUBLIC_` prefix for private keys.
- Firebase web configuration is used by the browser app; restrict the Firebase API key to the intended services/domains in Google Cloud/Firebase settings.
- Do not commit credentials, local `.env` files, CVs, generated PDFs, tokens, or real user data.
- Review tailored resumes, cover letters, answers, and job details before approving submissions.

## Validation

Frontend checks (run inside `frontend/`):

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Backend dependencies are listed in `backend/requirements.txt`. At runtime, check `/health`; use `/docs` to explore the API routes.
