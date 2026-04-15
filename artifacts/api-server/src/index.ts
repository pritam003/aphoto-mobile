import "dotenv/config";
import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

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

// Ensure album_shares table exists (idempotent startup migration)
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS album_shares (
    token        TEXT        PRIMARY KEY,
    album_id     UUID        NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    created_by   TEXT        NOT NULL,
    permission   TEXT        NOT NULL DEFAULT 'view',
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
