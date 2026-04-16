import "dotenv/config";
import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runFaceRecognitionJob } from "./lib/face-recognition.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Ensure album_shares table exists with all required columns (idempotent)
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS album_shares (
    token             TEXT        PRIMARY KEY,
    album_id          UUID        NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    created_by        TEXT        NOT NULL,
    name              TEXT,
    permission        TEXT        NOT NULL DEFAULT 'view',
    access_code_hash  TEXT        NOT NULL DEFAULT '',
    revoked_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
// Add new columns to existing tables (safe no-ops if already present)
await db.execute(sql`ALTER TABLE album_shares ADD COLUMN IF NOT EXISTS name TEXT`);
await db.execute(sql`ALTER TABLE album_shares ADD COLUMN IF NOT EXISTS access_code_hash TEXT NOT NULL DEFAULT ''`);
await db.execute(sql`ALTER TABLE album_shares ADD COLUMN IF NOT EXISTS share_type TEXT NOT NULL DEFAULT 'code'`);
await db.execute(sql`ALTER TABLE album_shares ADD COLUMN IF NOT EXISTS allowed_emails TEXT`);
await db.execute(sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS tags TEXT`);
await db.execute(sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS location_name TEXT`);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Run face recognition job 30s after startup, then every hour
  const FACE_JOB_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  setTimeout(() => {
    runFaceRecognitionJob().catch(() => {});
    setInterval(() => runFaceRecognitionJob().catch(() => {}), FACE_JOB_INTERVAL_MS);
  }, 30_000);
});
