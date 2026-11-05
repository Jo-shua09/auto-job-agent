# Verdant backend

The backend is a FastAPI service for Verdant, an AI-assisted job-search workspace. It verifies Firebase user sessions, stores user-scoped data in Firestore, discovers and scores jobs, prepares tailored application materials, tracks application state, and exposes the API used by the frontend.

## Responsibilities

- Verify Firebase ID tokens and establish per-user API sessions.
- Store and retrieve a career Vault and Scout preferences in Firestore.
- Parse uploaded CVs, produce tailored documents, and compile PDFs.
- Discover jobs using configured search providers, score matches, and stage jobs for review.
- Track approval, application execution, one-time verification requests, and inbox events.
- Enforce workflow transitions through the job state machine.

## Source map

```text
backend/
├── app/
│   ├── main.py                 FastAPI setup, CORS, static PDF mount, and API routes
│   ├── core/
│   │   ├── config.py           Reserved for centralized runtime configuration
│   │   └── firebase.py         Firebase Admin, Firestore, Storage, tenant context
│   ├── models/
│   │   └── schemas.py          Pydantic profile, job, and tailored-package schemas
│   ├── routers/                Route-module location; current route handlers are in main.py
│   └── services/
│       ├── auth_service.py       Firebase token and authentication helpers
│       ├── profile_service.py    Vault, profile, preference, and CV parsing logic
│       ├── scout_service.py      Job discovery, scoring, and activity stream
│       ├── tailor_service.py     Tailored package creation and retrieval
│       ├── pdf_compiler.py       Tailored CV PDF generation
│       ├── applicator_service.py Application execution and execution logs
│       ├── state_machine.py     Job state transitions
│       └── inbox_service.py     Inbox polling and email event processing
├── credentials/                 Optional local Firebase service-account file (ignored by Git)
├── generated_pdfs/              Runtime-generated application PDFs
├── requirements.txt             Python dependencies
└── .gitignore                   Excludes local environment, credentials, and generated files
```

## Requirements and local setup

Use Python with `pip`. Firebase access is required to start the API because Firestore is initialized when the application loads.

From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Create a local `.env` in `backend/` and supply the variables described below. For local Firebase Admin access, either:

1. Put a Firebase service-account JSON file at `credentials/serviceAccountKey.json` (the default path), or set `FIREBASE_CREDENTIALS_PATH` to its path; or
2. Set `FIREBASE_SERVICE_ACCOUNT_JSON` to the full service-account JSON object as a single environment-variable value.

Alternatively, on a machine configured with Google Cloud Application Default Credentials, Firebase Admin can use ADC when neither credential source is provided.

Run the API from `backend/`:

```powershell
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The API health check is `/health`, and FastAPI's interactive docs are at `/docs` (for example, `http://localhost:8000/docs`).

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | Yes | Firebase project ID used by Firebase Admin. If omitted while using service-account JSON, the project ID is read from that JSON. |
| `FIREBASE_STORAGE_BUCKET` | Recommended | Firebase Storage bucket for generated or uploaded assets. |
| `FIREBASE_CREDENTIALS_PATH` | One credential method required | Path to a service-account JSON file. Defaults to `./credentials/serviceAccountKey.json`. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | One credential method required | Full Firebase service-account JSON content, intended for a secret environment variable on hosts such as Render. |
| `FIREBASE_WEB_API_KEY` | Optional | Firebase Authentication REST API key for backend email/password helper flows. The browser sign-in uses the separate frontend Firebase web configuration. |
| `FRONTEND_ORIGINS` | Recommended | Comma-separated exact frontend origins allowed by CORS. Localhost development origins are defaults. |
| `GEMINI_API_KEY` | Required for AI workflows | Enables CV parsing, job discovery/scoring, tailoring, and supported application automation. |
| `SERPER_API_KEY` | Optional | Enables Serper-backed job search in Scout. |
| `JSEARCH_API_KEY` | Optional | Enables JSearch-backed job search in Scout. |
| `GMAIL_ADDRESS` | Optional | Gmail account used for live inbox polling. |
| `GMAIL_APP_PASSWORD` | Optional | Gmail app password used with the optional IMAP integration. |

Do not commit `.env`, service-account files, API keys, app passwords, ID tokens, or real user/job data. The backend `.gitignore` excludes local `.env`, `credentials/`, virtual environments, and generated PDFs.

## API overview

The API routes are currently registered in `app/main.py`:

| Route group | Purpose |
| --- | --- |
| `/health` | Service health check. |
| `/api/auth/*` | Establish and inspect authenticated sessions. |
| `/api/vault/*` | Read/update/reset the profile Vault and upload or test CV processing. |
| `/api/scout/*` | Manage search preferences, quota, and Scout runs. |
| `/api/jobs/*` | List jobs and history; approve, skip, or submit verification codes. |
| `/api/agent/*` | Read the agent activity stream. |
| `/api/tailor/*` | Create, retrieve, batch, and edit tailored packages. |
| `/api/apply/*` | Execute applications, run queued applications, and retrieve logs. |
| `/api/inbox/*` | Poll the inbox, simulate an email event, and list recorded events. |
| `/pdfs/*` | Serve generated PDFs. |

Most user-data routes require a Firebase-authenticated bearer token. See `/docs` for request and response schemas.

## Deploy to Render

Create a web service with `backend/` as its root directory. Install dependencies with:

```text
pip install -r requirements.txt
```

Use this start command:

```text
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

In the Render service's environment settings, add the required Firebase project/bucket configuration and a Firebase Admin service-account credential. For Render, the supported `FIREBASE_SERVICE_ACCOUNT_JSON` variable can hold the full service-account JSON value; alternatively, use Render's secret-file feature and point `FIREBASE_CREDENTIALS_PATH` at that file. Do not paste credentials into source code, README files, build logs, or frontend environment variables. Add `GEMINI_API_KEY` and any optional provider/inbox credentials required by the features you enable. Set `FRONTEND_ORIGINS` to the deployed frontend origin, without a trailing slash.

If the service exits during startup with a Google `DefaultCredentialsError`, it does not have credentials available to Firebase Admin. Configure the service-account JSON or secret file and redeploy. The app creates its Firestore client at startup, so a valid credential source must be available before Uvicorn imports `app.main`.

## Related documentation

- [Project overview and shared setup](../README.md)
- [Next.js frontend setup and deployment](../frontend/README.md)
