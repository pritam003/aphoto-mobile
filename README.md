# APhoto

A personal photo library — Google Photos-style, self-hosted on Azure. Sign in with Microsoft, keep your photos private.

---

## Features

- Upload photos & videos (JPG, PNG, HEIC, MP4) — drag-and-drop or file picker
- Library grouped by date, search by filename
- Favorites, Albums, Trash (soft-delete + restore)
- **Archive** — hide photos behind a TOTP lock (Microsoft Authenticator); recover via Gmail OTP if authenticator is lost
- **Import from Google Photos** — Picker API OAuth flow
- Dark mode
- Sign in with Microsoft / Azure Entra ID

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + Tailwind + TanStack Query |
| Backend | Node.js + Express + TypeScript |
| Auth | Microsoft Identity (MSAL) |
| Storage | Azure Blob Storage |
| Database | Azure PostgreSQL (Drizzle ORM) |
| Hosting | Azure Static Web Apps + Azure Container Apps |

---

## Quick Start

**Prerequisites:** Node 22+, pnpm, Azure CLI, Docker

```bash
# Install dependencies
pnpm install

# Start API (set env vars first — see below)
pnpm --filter api-server dev

# Start frontend
pnpm --filter my-photos dev
```

**Required env vars for the API:**

```
DATABASE_URL=
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER=
ENTRA_CLIENT_ID=
ENTRA_TENANT_ID=
SESSION_SECRET=
SMTP_FROM=
SMTP_USER=
SMTP_PASS=
```

---

## Deploy

```bash
# Build & push API image
az acr build --registry <acr-name> --image my-photos-api:<sha> --file artifacts/api-server/Dockerfile .

# Deploy frontend to Azure Static Web Apps
pnpm --filter my-photos build
npx @azure/static-web-apps-cli deploy artifacts/my-photos/dist/public --deployment-token $SWA_TOKEN --env production
```
