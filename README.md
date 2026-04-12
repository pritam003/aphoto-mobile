# My Photos

A Google Photos-style personal photo library — built with React, Express, Azure Blob Storage, and PostgreSQL. Sign in with any Microsoft account and your photos are stored privately in your own Azure infrastructure.

---

## What it looks like

| Login | Photo Library |
|---|---|
| ![Login page](docs/screenshots/01-login.png) | ![Library](docs/screenshots/04-library.png) |

| Device Code Sign-in | Upload Photos |
|---|---|
| ![Device code](docs/screenshots/02-device-code.png) | ![Upload modal](docs/screenshots/06-upload.png) |

| Albums |
|---|
| ![Albums](docs/screenshots/05-albums.png) |

---

## Features

- Upload photos and videos (JPG, PNG, HEIC, MP4) — drag-and-drop or file picker
- Browse your library grouped by date
- Search photos by filename
- Favorites — heart any photo
- Albums — create albums, upload directly to an album
- Trash — soft-delete with restore
- Dark mode
- Sign in with any Microsoft / Azure Entra ID account (Device Code Flow — works on any device)

---

## Prerequisites

You need:

1. A **Microsoft account** (personal @outlook.com, @hotmail.com, or work/school account)
2. An **Azure subscription** — [create a free one](https://azure.microsoft.com/free/) if you don't have one
3. The following tools installed locally:
   - [Node.js 22+](https://nodejs.org/)
   - [pnpm](https://pnpm.io/installation) — `npm install -g pnpm`
   - [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli) — `brew install azure-cli` on macOS
   - [GitHub CLI](https://cli.github.com/) — `brew install gh` on macOS
   - [Git](https://git-scm.com/)

---

## Step 1 — Fork & clone the repository

1. Fork this repo to your own GitHub account
2. Clone it locally:

```bash
git clone https://github.com/<YOUR_GITHUB_USERNAME>/photo-master-app.git
cd photo-master-app
pnpm install --no-frozen-lockfile
```

---

## Step 2 — Register an Azure Entra ID app

This gives users the ability to sign in with their Microsoft account.

1. Go to [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Fill in:
   - **Name**: `my-photos-app` (or anything you like)
   - **Supported account types**: *Accounts in any organizational directory and personal Microsoft accounts*
   - **Redirect URI**: leave blank for now
3. Click **Register**
4. On the app's overview page, copy the **Application (client) ID** — you'll need this as `MSAL_CLIENT_ID`
5. Also copy the **Directory (tenant) ID** — you'll need this as `AZURE_TENANT_ID`
6. Go to **Authentication** → scroll to **Advanced settings** → set **Allow public client flows** to **Yes** → Save

---

## Step 3 — Provision Azure resources

Log in to Azure CLI:

```bash
az login
az account set --subscription "<YOUR_SUBSCRIPTION_ID>"
```

Run these commands one by one. Replace the placeholder values shown in `< >`.

### Resource Group

```bash
az group create --name my-photos-rg --location eastus
```

### Container Registry (for the API Docker image)

```bash
az acr create \
  --resource-group my-photos-rg \
  --name <UNIQUE_ACR_NAME> \
  --sku Basic \
  --admin-enabled false
# e.g. --name myphotosacr123
```

### PostgreSQL Flexible Server

```bash
az postgres flexible-server create \
  --resource-group my-photos-rg \
  --name <UNIQUE_DB_SERVER_NAME> \
  --location eastus \
  --admin-user pgadmin \
  --admin-password "<STRONG_PASSWORD>" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --database-name photo_master \
  --public-access 0.0.0.0
```

> Note the connection string for later:
> `postgresql://pgadmin:<PASSWORD>@<SERVER_NAME>.postgres.database.azure.com/photo_master?sslmode=require`

### Blob Storage

```bash
az storage account create \
  --resource-group my-photos-rg \
  --name <UNIQUE_STORAGE_NAME> \
  --location eastus \
  --sku Standard_LRS \
  --kind StorageV2 \
  --allow-blob-public-access false

az storage container create \
  --account-name <UNIQUE_STORAGE_NAME> \
  --name photos \
  --auth-mode login
```

### Container Apps Environment & App

```bash
az provider register --namespace Microsoft.App --wait

az containerapp env create \
  --name my-photos-env \
  --resource-group my-photos-rg \
  --location eastus

az containerapp create \
  --name my-photos-api \
  --resource-group my-photos-rg \
  --environment my-photos-env \
  --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3
```

Note the Container App URL from the output (looks like `https://my-photos-api.<random>.eastus.azurecontainerapps.io`).

### Static Web App (frontend)

```bash
az staticwebapp create \
  --name my-photos-frontend \
  --resource-group my-photos-rg \
  --location eastus2 \
  --sku Free
```

Note the SWA URL from the output (looks like `https://<random>.azurestaticapps.net`).

---

## Step 4 — Configure the Container App

### Set secrets

```bash
az containerapp secret set \
  --name my-photos-api \
  --resource-group my-photos-rg \
  --secrets \
    db-url="postgresql://pgadmin:<PASSWORD>@<SERVER_NAME>.postgres.database.azure.com/photo_master?sslmode=require" \
    jwt-secret="$(openssl rand -hex 32)" \
    session-secret="$(openssl rand -hex 32)"
```

### Set environment variables

```bash
az containerapp update \
  --name my-photos-api \
  --resource-group my-photos-rg \
  --set-env-vars \
    NODE_ENV=production \
    PORT=3000 \
    APP_URL="https://<YOUR_SWA_URL>" \
    AZURE_STORAGE_ACCOUNT_NAME=<UNIQUE_STORAGE_NAME> \
    AZURE_STORAGE_CONTAINER_NAME=photos \
    AZURE_TENANT_ID=<YOUR_TENANT_ID> \
    MSAL_CLIENT_ID=<YOUR_APP_CLIENT_ID> \
    API_SELF_URL="https://<YOUR_CONTAINER_APP_URL>" \
    DATABASE_URL="secretref:db-url" \
    JWT_SECRET="secretref:jwt-secret" \
    SESSION_SECRET="secretref:session-secret"
```

---

## Step 5 — Assign managed identity to Container App

This lets the API access Blob Storage and generate SAS URLs without any stored keys.

```bash
# Enable system-assigned managed identity
az containerapp identity assign \
  --name my-photos-api \
  --resource-group my-photos-rg \
  --system-assigned

# Get the identity's principal ID
PRINCIPAL_ID=$(az containerapp show \
  --name my-photos-api \
  --resource-group my-photos-rg \
  --query identity.principalId -o tsv)

STORAGE_ID=$(az storage account show \
  --name <UNIQUE_STORAGE_NAME> \
  --resource-group my-photos-rg \
  --query id -o tsv)

# Grant blob read/write + SAS key generation
az role assignment create --assignee "$PRINCIPAL_ID" --role "Storage Blob Data Contributor" --scope "$STORAGE_ID"
az role assignment create --assignee "$PRINCIPAL_ID" --role "Storage Blob Delegator" --scope "$STORAGE_ID"

# Allow Container App to pull from ACR
ACR_ID=$(az acr show --name <UNIQUE_ACR_NAME> --resource-group my-photos-rg --query id -o tsv)
az role assignment create --assignee "$PRINCIPAL_ID" --role AcrPull --scope "$ACR_ID"

az containerapp registry set \
  --name my-photos-api \
  --resource-group my-photos-rg \
  --server <UNIQUE_ACR_NAME>.azurecr.io \
  --identity system
```

---

## Step 6 — Run database migrations

Allow your local IP temporarily, push the schema, then remove the rule:

```bash
MY_IP=$(curl -s https://api.ipify.org)

az postgres flexible-server firewall-rule create \
  --resource-group my-photos-rg \
  --name <DB_SERVER_NAME> \
  --rule-name allow-local \
  --start-ip-address "$MY_IP" \
  --end-ip-address "$MY_IP"

DATABASE_URL="postgresql://pgadmin:<PASSWORD>@<SERVER_NAME>.postgres.database.azure.com/photo_master?sslmode=require" \
  pnpm --filter @workspace/db run push

az postgres flexible-server firewall-rule delete \
  --resource-group my-photos-rg \
  --name <DB_SERVER_NAME> \
  --rule-name allow-local \
  --yes
```

---

## Step 7 — Set up GitHub Actions CI/CD

### Create a service principal for deployments

```bash
SP=$(az ad sp create-for-rbac \
  --name my-photos-deployer \
  --role Contributor \
  --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/my-photos-rg \
  --sdk-auth)

echo "$SP"  # Copy this JSON output
```

Also give it ACR push access:

```bash
SP_CLIENT_ID=$(echo "$SP" | python3 -c "import sys,json; print(json.load(sys.stdin)['clientId'])")
ACR_ID=$(az acr show --name <UNIQUE_ACR_NAME> --resource-group my-photos-rg --query id -o tsv)
az role assignment create --assignee "$SP_CLIENT_ID" --role AcrPush --scope "$ACR_ID"
```

### Get the SWA deployment token

```bash
az staticwebapp secrets list \
  --name my-photos-frontend \
  --resource-group my-photos-rg \
  --query "properties.apiKey" -o tsv
```

### Add GitHub Secrets

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** and add:

| Secret name | Value |
|---|---|
| `AZURE_CREDENTIALS` | The JSON blob from `az ad sp create-for-rbac` |
| `REGISTRY_LOGIN_SERVER` | `<UNIQUE_ACR_NAME>.azurecr.io` |
| `ACR_NAME` | `<UNIQUE_ACR_NAME>` |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWA token from above |
| `API_URL` | `https://<YOUR_CONTAINER_APP_URL>` |

### Push to deploy

```bash
git push origin main
```

The GitHub Actions pipeline will:
1. Build the Docker image and push it to ACR
2. Update the Container App to use the new image
3. Build the React frontend and deploy it to Static Web App

Watch progress at `https://github.com/<YOUR_USERNAME>/photo-master-app/actions`.

---

## Step 8 — Sign in and use the app

1. Open your Static Web App URL in a browser
2. Click **Sign in with Microsoft**

   ![Login page](docs/screenshots/01-login.png)

3. A device code appears — copy it, then click **Open Microsoft Login →**

   ![Device code](docs/screenshots/02-device-code.png)

4. Enter the code at [microsoft.com/devicelogin](https://microsoft.com/devicelogin) and sign in with your Microsoft account
5. The app automatically detects the completed sign-in and takes you to your library

   ![Library](docs/screenshots/04-library.png)

6. Click **Upload Photos** to add your first photos — drag-and-drop or click to browse

   ![Upload](docs/screenshots/06-upload.png)

---

## Architecture

```
Browser (React SPA)
      │
      │  HTTPS
      ▼
Azure Static Web App          ← frontend (HTML/JS/CSS)
      │
      │  /api/* (cross-origin fetch with credentials)
      ▼
Azure Container App           ← Express API (Node 22, Docker)
  ├── /api/auth/*             ← Device Code Flow + JWT HttpOnly cookie
  ├── /api/photos/*           ← upload · list · search · favorite · trash
  ├── /api/albums/*           ← create · list · add photos
  └── /api/blobs/*            ← local-dev blob proxy
      │                 │
      ▼                 ▼
Azure Blob Storage    Azure PostgreSQL    Azure Entra ID
(photos container)    (photo_master DB)  (Device Code + JWT)
```

**Auth flow:**
1. Frontend calls `/api/auth/login` → API requests a device code from Microsoft Entra ID
2. User visits [microsoft.com/devicelogin](https://microsoft.com/devicelogin) and enters the code
3. API polls Microsoft and receives an access token → creates a JWT → sets `HttpOnly; SameSite=None; Secure` cookie
4. All subsequent API calls carry the cookie automatically

**Blob serving:**
- In production, the API generates time-limited **user delegation SAS URLs** signed by the Container App's managed identity — the browser fetches images directly from Blob Storage with no stored keys
- In local dev, a proxy route `/api/blobs/*` streams blobs through the API (Vite proxies the cookie)

---

## Local development

```bash
# 1. Copy and fill in the env file
cp artifacts/api-server/.env.example artifacts/api-server/.env
# Fill in DATABASE_URL, MSAL_CLIENT_ID, AZURE_TENANT_ID,
# AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_CONTAINER_NAME

# 2. Start the API
cd artifacts/api-server
pnpm build
node --env-file=.env dist/index.mjs

# 3. In another terminal, start the frontend (proxies /api to localhost:3000)
cd artifacts/my-photos
pnpm dev
# Open http://localhost:5173
```

> For blob storage in local dev, run `az login` first — `DefaultAzureCredential` will use your local Azure CLI session.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 7, TanStack Query, Wouter, Tailwind CSS 4 |
| API | Express 5, Node.js 22, TypeScript |
| Auth | Azure Entra ID — Device Code Flow, JWT HttpOnly cookies |
| Database | PostgreSQL 16 (Azure Flexible Server), Drizzle ORM |
| Storage | Azure Blob Storage, DefaultAzureCredential (keyless) |
| Hosting | Azure Static Web Apps (frontend) + Azure Container Apps (API) |
| CI/CD | GitHub Actions |
| Monorepo | pnpm workspaces |


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
