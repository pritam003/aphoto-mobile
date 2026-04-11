# Photo Master

A Google Photos-like personal photo library built with React, Express, Azure Blob Storage, and PostgreSQL.

**Features**
- Upload, browse, and search photos
- Albums — create, upload directly to an album, add existing photos
- Favorites
- Trash (soft-delete with restore)
- Multi-select with bulk download and bulk delete
- Azure Entra ID sign-in (Device Code Flow)
- Keyless Azure Blob Storage via `DefaultAzureCredential`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, TanStack Query, Wouter |
| Backend | Express 5, TypeScript, Node 22 |
| Database | PostgreSQL + Drizzle ORM |
| Storage | Azure Blob Storage (keyless via Managed Identity / `az login`) |
| Auth | Azure Entra ID — Device Code Flow |
| Monorepo | pnpm workspaces |

---

## Prerequisites

- **Node.js 22+** — `node --version`
- **pnpm 9+** — `npm i -g pnpm`
- **PostgreSQL** running locally (default: `postgres/postgres` on port 5432)
- **Azure CLI** — `brew install azure-cli` then `az login`
- An **Azure Subscription** with:
  - An **App Registration** (Entra ID) with Device Code Flow enabled
  - An **Azure Blob Storage** account with a container named `photos`

---

## Azure Setup (One-time)

### 1. App Registration (Entra ID)

1. Go to [portal.azure.com](https://portal.azure.com) → **Entra ID** → **App registrations** → **New registration**
2. Name: `My Photos Local`
3. Supported account types: **Single tenant**
4. Click **Register**
5. Copy the **Application (client) ID** and **Directory (tenant) ID** — you'll need these in `.env`
6. Go to **Authentication** → Enable **Allow public client flows** → Save

### 2. Azure Blob Storage

1. Create a Storage Account (Standard LRS, any region)
2. Create a container named `photos` (private access)
3. Copy the **Storage account name**
4. Assign yourself RBAC roles on the storage account:

```bash
# Replace with your values
STORAGE_ACCOUNT=your-storage-account-name
RESOURCE_GROUP=your-resource-group
USER_OBJECT_ID=$(az ad signed-in-user show --query id -o tsv)

az role assignment create \
  --assignee $USER_OBJECT_ID \
  --role "Storage Blob Data Contributor" \
  --scope $(az storage account show -n $STORAGE_ACCOUNT -g $RESOURCE_GROUP --query id -o tsv)

az role assignment create \
  --assignee $USER_OBJECT_ID \
  --role "Storage Blob Delegator" \
  --scope $(az storage account show -n $STORAGE_ACCOUNT -g $RESOURCE_GROUP --query id -o tsv)
```

> Role assignments can take 2–5 minutes to propagate.

---

## Local Development Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/YOUR_USERNAME/photo-master.git
cd photo-master
pnpm install
```

### 2. Create the database

```bash
psql -U postgres -c "CREATE DATABASE photo_master_dev;"
```

### 3. Configure environment

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
```

Edit `artifacts/api-server/.env` with your values:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/photo_master_dev
AZURE_TENANT_ID=<your-tenant-id>
AZURE_CLIENT_ID=<your-client-id>
AZURE_STORAGE_ACCOUNT_NAME=<your-storage-account>
AZURE_STORAGE_CONTAINER_NAME=photos
APP_URL=http://localhost:3000
```

### 4. Push the database schema

```bash
cd lib/db && pnpm push
cd ../..
```

### 5. Log in to Azure CLI (for keyless blob access)

```bash
az login
```

### 6. Start the servers

**Terminal 1 — API server:**
```bash
cd artifacts/api-server
node build.mjs
node --env-file=.env --enable-source-maps dist/index.mjs
```

**Terminal 2 — Frontend:**
```bash
cd artifacts/my-photos
PORT=5173 BASE_PATH=/ pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) — click **Sign in with Microsoft**, follow the Device Code Flow instructions.

---

## How the App Works

### Authentication — Device Code Flow

1. Click **Sign in with Microsoft**
2. The server calls Azure's `/devicecode` endpoint and returns a short code
3. You visit `https://microsoft.com/devicelogin`, enter the code, and sign in
4. The server polls Azure and once approved, issues a JWT stored in an HTTP-only cookie
5. All subsequent API requests are authenticated via this cookie

### Photo Storage

Photos are stored in Azure Blob Storage under the path:
```
{userId}/{photoId}.jpg              (library upload)
{userId}/{albumId}/{photoId}.jpg    (album upload)
```

The backend never exposes Azure credentials to the browser. Instead, `/api/blobs/*` proxies blob reads server-side using `DefaultAzureCredential`.

### Database Schema

| Table | Purpose |
|---|---|
| `photos` | Photo metadata (filename, blob name, size, favorite, trashed) |
| `albums` | Album definitions per user |
| `album_photos` | Many-to-many: photo ↔ album |

---

## Project Structure

```
photo-master/
├── artifacts/
│   ├── api-server/          # Express API (TypeScript, built with esbuild)
│   │   ├── src/
│   │   │   ├── app.ts       # Express setup, JWT middleware
│   │   │   ├── lib/
│   │   │   │   ├── auth.ts          # Azure Device Code Flow helpers
│   │   │   │   ├── azure-storage.ts # Blob upload/download/proxy
│   │   │   │   └── logger.ts
│   │   │   └── routes/
│   │   │       ├── auth.ts    # /api/auth/* — login, callback, me, logout
│   │   │       ├── photos.ts  # /api/photos — CRUD + upload
│   │   │       ├── albums.ts  # /api/albums — album management
│   │   │       ├── blobs.ts   # /api/blobs/* — server-side blob proxy
│   │   │       ├── shares.ts  # /api/shares — share links
│   │   │       └── health.ts  # /api/health
│   │   └── .env.example
│   └── my-photos/           # React frontend (Vite)
│       └── src/
│           ├── pages/       # library, albums, album-detail, favorites, trash, login
│           ├── components/  # PhotoGrid (multi-select), UploadModal, Lightbox, Sidebar
│           └── hooks/       # useAuth, use-toast, use-mobile
├── lib/
│   ├── db/                  # Drizzle schema + migrations
│   ├── api-client-react/    # Generated React Query hooks (from OpenAPI spec)
│   └── api-spec/            # OpenAPI YAML + Orval codegen config
└── .github/
    └── workflows/
        └── deploy.yml       # CI/CD: build → migrate → deploy to Azure
```

---

## Common Issues

| Problem | Fix |
|---|---|
| `DATABASE_URL must be set` | Use `node --env-file=.env` (not `dotenv`) when starting the server |
| Images not loading | Make sure `az login` is done; blob proxy requires an active Azure session |
| `BlobServiceClient: 403` | Wait 5 min for RBAC roles to propagate; verify with `az role assignment list` |
| Server crashes silently | Run with `--enable-source-maps` flag to get proper stack traces |
| `path-to-regexp` wildcard error | Already fixed — blob route uses `Array.isArray` check for `*blobName` param |
| Device code expired | Codes expire in ~15 min; click Sign In again to get a new one |
