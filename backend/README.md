# Verdant backend

The FastAPI backend powers Verdant's authenticated workspace and application workflows. It stores users and user-scoped records in MongoDB, verifies email/password credentials and Google ID tokens, and issues signed Verdant bearer tokens.

## Responsibilities

- Register and authenticate email/password and Google accounts.
- Store a career Vault, search preferences, jobs, tailored packages, application logs, inbox events, and activity in MongoDB.
- Parse uploaded CVs, discover and score roles, prepare tailored materials, and compile PDFs.
- Track review, application, verification-code, and inbox workflows.
- Enforce tenant isolation on every user-owned document operation.

New accounts start with blank workspaces. There is no Firebase authentication, Firestore access, or legacy Firebase data import.

## Source map

```text
backend/
├── app/
│   ├── main.py                  FastAPI setup, CORS, auth and application routes
│   ├── core/
│   │   └── database.py          MongoDB client, indexes, and owner-scoped collection adapter
│   ├── models/
│   │   └── schemas.py           Pydantic Vault, job, and tailored-package schemas
│   └── services/
│       ├── auth_service.py       Password hashing, Google verification, and signed sessions
│       ├── profile_service.py    Vault, preferences, quotas, and CV parsing
│       ├── scout_service.py      Job discovery, scoring, and activity
│       ├── tailor_service.py     Tailored package creation and retrieval
│       ├── pdf_compiler.py       Tailored CV PDF generation
│       ├── applicator_service.py Application workflow and execution logs
│       ├── state_machine.py      Job state transitions
│       └── inbox_service.py      Inbox polling and email-event processing
├── generated_pdfs/               Runtime-generated PDFs (ephemeral on Render)
└── requirements.txt
```

The Mongo adapter stores each user's records in shared MongoDB collections with an enforced `user_id` owner filter. Document identifiers are namespaced per user so identical IDs in different accounts cannot collide.

## Local setup

Use Python and pip. From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m playwright install chromium
```

Create `backend/.env` with:

```dotenv
MONGODB_URI=mongodb+srv://<database-user>:<url-encoded-password>@<cluster-host>/verdant?retryWrites=true&w=majority
MONGODB_DATABASE=verdant
AUTH_JWT_SECRET=<random-secret-at-least-32-characters>
GOOGLE_CLIENT_ID=<Google-OAuth-web-client-id>
FRONTEND_ORIGINS=http://localhost:3000
```

Start the service from `backend/`:

```powershell
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`/health` performs a MongoDB ping; `/docs` provides the interactive API reference. Authentication routes are `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/google`, and `GET /api/auth/me`.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB Atlas connection URI or a local MongoDB URI. URL-encode special characters in the database user's password. |
| `MONGODB_DATABASE` | Recommended | Database name; defaults to `verdant`. |
| `AUTH_JWT_SECRET` | Yes | Random signing secret with at least 32 characters. Keep it private and stable across deployments so existing sessions remain valid. |
| `GOOGLE_CLIENT_ID` | Required for Google sign-in | OAuth 2.0 web application client ID. The backend verifies the ID-token audience against this value. |
| `FRONTEND_ORIGINS` | Yes in production | Comma-separated exact browser origins allowed by CORS, without trailing slashes. |
| `GEMINI_API_KEY` | For AI workflows | Enables CV parsing, job discovery/scoring, tailoring, and supported automation. |
| `SERPER_API_KEY` | Optional | Enables Serper-backed job search. |
| `JSEARCH_API_KEY` | Optional | Enables JSearch-backed job search. |
| `GMAIL_ADDRESS` | Optional | Gmail account used for live inbox polling. |
| `GMAIL_APP_PASSWORD` | Optional | Gmail app password for the optional IMAP integration. |

Never commit `.env`, MongoDB URIs, JWT secrets, provider keys, Gmail app passwords, tokens, CVs, or generated personal documents.

## Configure MongoDB Atlas

1. Create an Atlas project and cluster.
2. Under **Database Access**, create a dedicated database user and grant read/write access to the `verdant` database. Do not use the Atlas account-owner password as the application credential.
3. Under **Network Access**, allow the Render service to connect. Prefer a fixed outbound IP allowlist if your Render plan provides one. If it does not, Atlas may require a broader allowlist; use a strong unique database password and restrict the database user's role to this app database.
4. Choose **Connect → Drivers**, copy the URI, replace the placeholders, and URL-encode any reserved characters in the password.
5. Add the URI and database name to Render as secret environment variables. Do not include the URI in `NEXT_PUBLIC_*` variables.

Atlas creates the database and collections when the application first writes data. The backend creates its unique user-email index on first authentication.

## Google sign-in setup

Create an OAuth 2.0 **Web application** client in Google Cloud Console. Add these authorized JavaScript origins:

- `http://localhost:3000` for local development
- `https://verdant-agent.vercel.app` for the deployed frontend

Use the same client ID for backend `GOOGLE_CLIENT_ID` and frontend `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. No service-account key or Firebase project is needed for login.

## Deploy to Render

Configure the Render web service with:

- **Root directory:** `backend`
- **Build command:** `pip install -r requirements.txt && python -m playwright install chromium`
- **Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Health check path:** `/health`

Add these environment variables in Render:

```text
MONGODB_URI=<Atlas connection URI>
MONGODB_DATABASE=verdant
AUTH_JWT_SECRET=<random secret, at least 32 characters>
GOOGLE_CLIENT_ID=<Google OAuth web client ID>
FRONTEND_ORIGINS=https://verdant-agent.vercel.app
```

Add optional AI/search/Gmail credentials only for features you intend to use. A healthy `/health` response includes `"mongodb_connected": true`; if it fails, verify the URI, Atlas network access, and database user's privileges.

## API route groups

Routes are currently registered in `app/main.py`:

| Route group | Purpose |
| --- | --- |
| `/health` | MongoDB-backed health check. |
| `/api/auth/*` | Email/password, Google, and current-session endpoints. |
| `/api/vault/*` | Profile Vault, reset, and CV handling. |
| `/api/scout/*` | Search preferences, quotas, and Scout runs. |
| `/api/jobs/*` | Job lists, history, approvals, and verification codes. |
| `/api/agent/*` | Agent activity. |
| `/api/tailor/*` | Tailored application packages. |
| `/api/apply/*` | Application execution and logs. |
| `/api/inbox/*` | Inbox polling and email events. |
| `/pdfs/*` | Generated PDF files. |

Password recovery email delivery is not implemented. Generated PDFs use local storage, which is not persistent across Render instances/restarts; use object storage if durable PDF delivery is required.

See the [project overview](../README.md) and [frontend guide](../frontend/README.md).
