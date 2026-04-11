# 📸 Photo Master

A Google Photos-like personal photo library built with **React**, **Express**, **Azure Blob Storage**, and **PostgreSQL**.

![Library view](docs/screenshots/multiselect.png)

---

## ✨ Features

| | Feature |
|---|---|
| 🖼 | Upload, browse & search photos (drag-and-drop supported) |
| 📁 | Albums — create, upload directly to album, add existing photos |
| ❤️ | Favorites |
| 🗑 | Trash with soft-delete & restore |
| ☑️ | Multi-select — bulk download and bulk delete |
| 🔐 | Azure Entra ID sign-in (Device Code Flow) |
| ☁️ | Keyless Azure Blob Storage via `DefaultAzureCredential` |

---

## 📷 Screenshots

| Login | Photo Library |
|---|---|
| ![Login](docs/screenshots/login.png) | ![Library](docs/screenshots/library.png) |

| Albums | Multi-select |
|---|---|
| ![Albums](docs/screenshots/albums.png) | ![Multi-select](docs/screenshots/multiselect.png) |

---

## 🏗 Architecture

```mermaid
graph TB
    subgraph Browser
        FE["React SPA<br/>(Vite · TanStack Query · Wouter)"]
    end

    subgraph Azure
        BLOB["Azure Blob Storage<br/>(myphotosblobstorage)"]
        ENTRA["Azure Entra ID<br/>(Device Code Flow)"]
        PG["PostgreSQL<br/>(Flexible Server)"]
    end

    subgraph API["Express API (Node 22)"]
        AUTH["/api/auth/*<br/>Device Code + JWT cookie"]
        PHOTOS["/api/photos/*<br/>Upload · CRUD · Search"]
        ALBUMS["/api/albums/*<br/>Albums · Members"]
        BLOBS["/api/blobs/*<br/>Blob proxy (server-side auth)"]
    end

    FE -- "/api/*  (Vite proxy)" --> API
    AUTH -- "poll token" --> ENTRA
    PHOTOS -- "upload / stream" --> BLOB
    BLOBS -- "stream blob (DefaultAzureCredential)" --> BLOB
    PHOTOS -- "metadata" --> PG
    ALBUMS -- "metadata" --> PG
```

---

## 🔐 Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant App as React App
    participant API as Express API
    participant MS as Microsoft Entra ID

    User->>App: Click "Sign in with Microsoft"
    App->>API: GET /api/auth/login
    API->>MS: POST /oauth2/v2.0/devicecode
    MS-->>API: { user_code, device_code }
    API-->>App: { user_code, verification_uri }
    App-->>User: Show code "ABCD-1234"
    User->>MS: Visit microsoft.com/devicelogin, enter code
    loop Poll every 2s
        App->>API: POST /api/auth/device-code-status
        API->>MS: POST /oauth2/v2.0/token
        MS-->>API: access_token ✅
    end
    API->>API: Create JWT, set HttpOnly cookie
    App->>App: Redirect to /
```

---

## 📦 Photo Storage Layout

```mermaid
graph LR
    subgraph Blob["Azure Blob Storage · photos container"]
        direction TB
        U1["userId/<br/>├── photoId.jpg<br/>├── photoId.jpg<br/>└── albumId/<br/>    └── photoId.jpg"]
    end

    Upload["POST /api/photos<br/>(FormData + optional albumId)"] --> U1
    Proxy["GET /api/blobs/*blobName<br/>(server-side stream)"] --> U1
```

Photos are stored under `{userId}/{photoId}.jpg` for library uploads and `{userId}/{albumId}/{photoId}.jpg` for album uploads. The browser **never** gets a direct SAS URL — the Express server proxies all blob reads using `DefaultAzureCredential`.

---

## 🗄 Database Schema

```mermaid
erDiagram
    photos {
        uuid id PK
        string userId
        string filename
        string blobName
        int fileSize
        boolean favorite
        boolean trashed
        timestamp trashedAt
        timestamp createdAt
    }
    albums {
        uuid id PK
        string userId
        string name
        string description
        timestamp createdAt
    }
    album_photos {
        uuid albumId FK
        uuid photoId FK
        timestamp addedAt
    }

    albums ||--o{ album_photos : contains
    photos ||--o{ album_photos : "in"
```

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 7, Tailwind CSS 4, TanStack Query, Wouter |
| Backend | Express 5, TypeScript, Node 22 |
| Database | PostgreSQL + Drizzle ORM |
| Storage | Azure Blob Storage (keyless via `DefaultAzureCredential`) |
| Auth | Azure Entra ID — Device Code Flow |
| Build | esbuild (API bundle), Vite (frontend) |
| Monorepo | pnpm workspaces |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 22+** — `node --version`
- **pnpm 9+** — `npm i -g pnpm`
- **PostgreSQL** running locally
- **Azure CLI** — `brew install azure-cli`
- An Azure Subscription with an App Registration and Blob Storage account

### 1. Clone & install

```bash
git clone https://github.com/pritam003/photo-master-app.git
cd photo-master-app
pnpm install
```

### 2. Create the database

```bash
psql -U postgres -c "CREATE DATABASE photo_master_dev;"
```

### 3. Configure environment

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
# Edit the file with your Azure values
```

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
cd lib/db && pnpm push && cd ../..
```

### 5. Log in to Azure CLI (keyless blob access)

```bash
az login
```

### 6. Start the servers

**Terminal 1 — API:**
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

Open **http://localhost:5173** → click **Sign in with Microsoft** → follow the Device Code instructions.

---

## 🔧 Azure Setup (One-time)

### App Registration

1. **Entra ID** → App registrations → New registration
2. Name it, single tenant, click Register
3. Copy **Application (client) ID** and **Directory (tenant) ID**
4. Go to **Authentication** → enable **Allow public client flows** → Save

### Blob Storage RBAC

```bash
STORAGE=your-storage-account
RG=your-resource-group
ME=$(az ad signed-in-user show --query id -o tsv)
SCOPE=$(az storage account show -n $STORAGE -g $RG --query id -o tsv)

az role assignment create --assignee $ME --role "Storage Blob Data Contributor" --scope $SCOPE
az role assignment create --assignee $ME --role "Storage Blob Delegator" --scope $SCOPE
```

> Wait 2–5 min for roles to propagate.

---

## 📁 Project Structure

```
photo-master-app/
├── artifacts/
│   ├── api-server/          # Express API
│   │   ├── src/
│   │   │   ├── app.ts             # Express setup, JWT middleware
│   │   │   ├── lib/
│   │   │   │   ├── auth.ts        # Device Code Flow helpers
│   │   │   │   └── azure-storage.ts # Blob upload + proxy
│   │   │   └── routes/
│   │   │       ├── auth.ts        # /api/auth/*
│   │   │       ├── photos.ts      # /api/photos/*
│   │   │       ├── albums.ts      # /api/albums/*
│   │   │       └── blobs.ts       # /api/blobs/* (proxy)
│   │   ├── Dockerfile
│   │   └── .env.example
│   └── my-photos/           # React frontend
│       └── src/
│           ├── pages/       # library, albums, favorites, trash, login
│           └── components/  # PhotoGrid (multi-select), UploadModal, Lightbox
├── lib/
│   ├── db/                  # Drizzle schema + migrations
│   ├── api-client-react/    # Generated React Query hooks
│   └── api-spec/            # OpenAPI YAML
└── .github/
    └── workflows/
        └── deploy.yml       # CI/CD to Azure
```

---

## 🐛 Common Issues

| Problem | Fix |
|---|---|
| `DATABASE_URL must be set` | Use `node --env-file=.env` when starting the server |
| Images not loading | Run `az login`; blob proxy needs an active Azure credential |
| `403` on blob upload | Wait 5 min for RBAC roles to propagate |
| Device code expired | Codes expire in ~15 min; click Sign In again |
| `split is not a function` on blobs | Already fixed — `Array.isArray` check on wildcard param |
