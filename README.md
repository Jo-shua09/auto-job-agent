# Verdant

Verdant is an AI-assisted job-search workspace. It helps each user discover roles, tailor application materials using their own career profile, and manage applications through a review-first workflow. Users keep control of submissions and should verify generated documents and answers before applying.

The application has a Next.js frontend and a FastAPI backend. MongoDB Atlas stores accounts and user-scoped application data. Email/password accounts are stored with scrypt password hashes; Google sign-in is verified by the backend and exchanged for a signed Verdant session token. Firebase is no longer part of the application.

## What the app does

- **Career Vault:** maintain experience, projects, education, skills, and application details, or upload a PDF CV for parsing.
- **Search preferences:** choose job titles, locations, work modes, match preferences, and daily application limits.
- **Scout:** discover and score roles, or paste a job URL or description.
- **Tailoring:** prepare a tailored CV, cover letter, and screening answers from the user's saved career information.
- **Review queue:** inspect and edit application materials before approving an application.
- **Application tracking:** follow application status, activity, inbox events, and requests for one-time verification codes.

The workspace starts blank for each new account. Existing Firebase users and Firestore data are **not imported**; users create a new Verdant account and enter their career profile again.

## Repository map

```text
.
├── README.md
├── backend/
│   ├── README.md
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 FastAPI setup, authentication endpoints, and API routes
│       ├── core/database.py        MongoDB client and user-scoped document access
│       ├── models/                 Pydantic profile, job, and application schemas
│       └── services/               Authentication, Vault, Scout, tailoring, applying, and inbox logic
└── frontend/
    ├── README.md
    ├── assets/                     Source branding artwork
    ├── public/                     Static website assets
    └── src/
        ├── app/                    Next.js routes, metadata, icons, and styles
        ├── components/             Workspace shell, route guard, and shared UI
        └── lib/                    API client, session client, theme, and shared utilities
```

See [backend/README.md](./backend/README.md) for Atlas, Render, and OAuth configuration and [frontend/README.md](./frontend/README.md) for local and Vercel setup.

## Run locally

You need Node.js, pnpm 10, Python, a MongoDB database (Atlas or local), and any API keys for optional integrations.

### Backend

From `backend/`, create a `.env` file containing at least:

```dotenv
MONGODB_URI=mongodb+srv://<database-user>:<url-encoded-password>@<cluster-host>/verdant?retryWrites=true&w=majority
MONGODB_DATABASE=verdant
AUTH_JWT_SECRET=<random-secret-at-least-32-characters>
GOOGLE_CLIENT_ID=<Google-OAuth-web-client-id>
FRONTEND_ORIGINS=http://localhost:3000
```

Install and start the API:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The health endpoint is [http://localhost:8000/health](http://localhost:8000/health); API documentation is at [http://localhost:8000/docs](http://localhost:8000/docs).

### Frontend

Create `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<same-Google-OAuth-web-client-id>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then run:

```powershell
cd frontend
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Set the Google OAuth client's authorized JavaScript origins to `http://localhost:3000` for local use.

## Deployments

- **MongoDB Atlas:** create a database user with read/write access to the application database and allow the backend's network to reach the cluster. See the backend guide for details.
- **Backend on Render:** use `backend/` as the service root, install from `requirements.txt`, and run `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set `MONGODB_URI`, `MONGODB_DATABASE`, `AUTH_JWT_SECRET`, `GOOGLE_CLIENT_ID`, and `FRONTEND_ORIGINS` in Render's environment settings.
- **Frontend on Vercel:** use `frontend/` as the project root and set `NEXT_PUBLIC_API_URL` to the Render API origin, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to the Google OAuth web client ID, and `NEXT_PUBLIC_SITE_URL` to the public site URL. Redeploy after changing environment variables.
- **CORS and Google OAuth:** set `FRONTEND_ORIGINS` to the exact deployed Vercel origin. Add that same origin to the Google OAuth client's authorized JavaScript origins.

For the currently deployed frontend, the origin is `https://verdant-agent.vercel.app`. Do not paste credentials into source files, commits, tickets, or chat. Never expose the MongoDB URI or JWT secret through a `NEXT_PUBLIC_` variable.

## Important limitations

- Password-reset email delivery is not implemented. The reset-password screen is a placeholder and should not be represented as a working recovery flow.
- Generated PDFs are written to the backend's local `generated_pdfs` directory. Render's local filesystem is ephemeral; use persistent object storage if generated files must survive service restarts or be reliably shared.
- Optional AI, job-search, and Gmail integrations require their own provider credentials; see the backend guide.
- This migration only changes the application's active persistence/authentication. Firebase data remains in its existing Firebase project and is not copied or deleted.

## Validation

Run frontend checks from `frontend/`:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Run backend tests or compile checks from `backend/`; check `/health` after deployment to confirm MongoDB connectivity.
