/**
 * Photo processing worker — runs as a separate Container App (my-photos-worker-in).
 * Uses the same Docker image as the API server but with a different CMD.
 *
 * Responsibilities (all decoupled from upload latency):
 *   1. AI vision tags      — Azure Computer Vision for every untagged photo
 *   2. GPS + location name — EXIF extraction + Nominatim reverse-geocode
 *   3. Face recognition    — TensorFlow local inference, hourly batch
 *
 * Polling interval: 30 s (for tags + GPS), 1 hour (face recognition)
 */

import "dotenv/config";
import { db, photosTable } from "@workspace/db";
import { sql, isNull, and, like, eq } from "drizzle-orm";
import { downloadBlob } from "./lib/azure-storage.js";
import { analyzePhoto } from "./lib/azure-vision.js";
import { runFaceRecognitionJob } from "./lib/face-recognition.js";
import { logger } from "./lib/logger.js";
import exifr from "exifr";

// ── Config ────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS   = 30_000;     // tags + GPS: every 30 s
const FACE_INTERVAL_MS   = 60 * 60 * 1000; // face recognition: every hour
const GPS_RATE_LIMIT_MS  = 1100;       // Nominatim: max 1 req/sec
const VISION_BATCH       = parseInt(process.env.VISION_BATCH ?? "5", 10);
const GPS_BATCH          = parseInt(process.env.GPS_BATCH   ?? "20", 10);

// ── Reverse geocode ───────────────────────────────────────────────────────────

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "PhotoMasterWorker/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const data = await res.json() as { address?: Record<string, string> };
    const a = data.address ?? {};
    const parts = [
      a.suburb || a.neighbourhood || a.village || a.town,
      a.city || a.municipality || a.county,
      a.state,
      a.country,
    ].filter(Boolean) as string[];
    return parts.join(", ");
  } catch {
    return "";
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Vision tags pass ──────────────────────────────────────────────────────────

async function runVisionPass(): Promise<void> {
  const rows = await db.execute(sql`
    SELECT id, blob_name, content_type
    FROM photos
    WHERE tags IS NULL
      AND content_type LIKE 'image/%'
      AND trashed = false
    ORDER BY uploaded_at DESC
    LIMIT ${VISION_BATCH}
  `);

  if (rows.rows.length === 0) return;
  logger.info({ count: rows.rows.length }, "[worker] vision: processing batch");

  for (const row of rows.rows as Array<{ id: string; blob_name: string; content_type: string }>) {
    try {
      const buf = await downloadBlob(row.blob_name);
      const tags = await analyzePhoto(buf, row.content_type);
      // Set to empty string when no tags returned so it won't be re-processed endlessly
      await db.execute(sql`UPDATE photos SET tags = ${tags || ""} WHERE id = ${row.id}`);
      logger.info({ id: row.id, tags }, "[worker] vision: tagged");
    } catch (err) {
      logger.warn({ id: row.id, err }, "[worker] vision: failed, will retry");
    }
  }
}

// ── GPS / location pass ───────────────────────────────────────────────────────

async function runGpsPass(): Promise<void> {
  const rows = await db.execute(sql`
    SELECT id, blob_name, content_type
    FROM photos
    WHERE location_name IS NULL
      AND content_type LIKE 'image/%'
      AND trashed = false
    ORDER BY uploaded_at DESC
    LIMIT ${GPS_BATCH}
  `);

  if (rows.rows.length === 0) return;
  logger.info({ count: rows.rows.length }, "[worker] gps: processing batch");

  for (const row of rows.rows as Array<{ id: string; blob_name: string; content_type: string }>) {
    try {
      const buf = await downloadBlob(row.blob_name);
      const gps = await exifr.gps(buf).catch(() => null);

      if (gps?.latitude != null && gps?.longitude != null) {
        const location = await reverseGeocode(gps.latitude, gps.longitude);
        await db.execute(sql`UPDATE photos SET location_name = ${location || ""} WHERE id = ${row.id}`);
        if (location) {
          logger.info({ id: row.id, location }, "[worker] gps: geocoded");
          await sleep(GPS_RATE_LIMIT_MS); // honour Nominatim 1 req/s limit
        } else {
          await db.execute(sql`UPDATE photos SET location_name = '' WHERE id = ${row.id}`);
        }
      } else {
        // No GPS in EXIF — mark as processed so we skip it next run
        await db.execute(sql`UPDATE photos SET location_name = '' WHERE id = ${row.id}`);
      }
    } catch (err) {
      logger.warn({ id: row.id, err }, "[worker] gps: failed, will retry");
    }
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

let _shutdown = false;

process.on("SIGTERM", () => {
  logger.info("[worker] SIGTERM received — finishing current batch then exiting");
  _shutdown = true;
});
process.on("SIGINT", () => { _shutdown = true; });

logger.info("[worker] Photo processing worker started");

// Face recognition: first run 30 s after startup, then hourly
setTimeout(() => {
  runFaceRecognitionJob().catch((err) => logger.warn({ err }, "[worker] face: job error"));
  setInterval(() => {
    runFaceRecognitionJob().catch((err) => logger.warn({ err }, "[worker] face: job error"));
  }, FACE_INTERVAL_MS);
}, 30_000);

// Vision + GPS: run immediately, then every 30 s
async function pollLoop() {
  while (!_shutdown) {
    try {
      await runVisionPass();
      await runGpsPass();
    } catch (err) {
      logger.warn({ err }, "[worker] poll error");
    }
    await sleep(POLL_INTERVAL_MS);
  }
  logger.info("[worker] shutdown complete");
  process.exit(0);
}

pollLoop();
