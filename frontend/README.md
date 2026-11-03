# Verdant

Verdant is an autonomous job-hunting agent that finds relevant roles, tailors applications using your verified career details, and keeps you in control of what gets submitted.

## Frontend development

Install dependencies and start the development server from this directory:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

The workspace uses Firebase Authentication and the FastAPI service; it does not provide demo accounts or seeded profile/job data. Configure the `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, and optional `NEXT_PUBLIC_API_URL` environment variables before signing in. The API defaults to `http://localhost:8000`.

New accounts start with an empty Vault and Scout configuration. Save your name, email, and at least one verified experience, project, or skill, then save at least one target role before launching the agent.

## Validation

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```
