import { Router } from "express";
import { getContainerClient } from "../lib/azure-storage.js";

const router = Router();

// Proxy blob downloads — authenticates via DefaultAzureCredential, no SAS or account key needed.
// Supports HTTP Range requests so browsers can stream video (seeking, progressive load).
router.get("/blobs/*blobName", async (req, res) => {
  // Require valid JWT (set by app.ts middleware)
  const user = (req as Record<string, unknown>).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  // path-to-regexp v8 wildcard captures as an array of segments — join back into a path
  const raw = req.params.blobName;
  const blobName = Array.isArray(raw) ? raw.join("/") : String(raw);

  try {
    const containerClient = getContainerClient();
    const blobClient = containerClient.getBlobClient(blobName);

    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      // Partial content request — required for video seeking/streaming
      const props = await blobClient.getProperties();
      const totalSize = props.contentLength!;
      const contentType = props.contentType || "application/octet-stream";

      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) return res.status(416).set("Content-Range", `bytes */${totalSize}`).end();

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

      if (start >= totalSize || end >= totalSize) {
        return res.status(416).set("Content-Range", `bytes */${totalSize}`).end();
      }

      const chunkSize = end - start + 1;
      const downloadResponse = await blobClient.download(start, chunkSize);

      if (!downloadResponse.readableStreamBody) {
        return res.status(404).json({ error: "Blob not found" });
      }

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", chunkSize);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=3600");

      downloadResponse.readableStreamBody.pipe(res);
    } else {
      // Full download
      const downloadResponse = await blobClient.download();

      if (!downloadResponse.readableStreamBody) {
        return res.status(404).json({ error: "Blob not found" });
      }

      res.setHeader("Content-Type", downloadResponse.contentType || "application/octet-stream");
      if (downloadResponse.contentLength) {
        res.setHeader("Content-Length", downloadResponse.contentLength);
      }
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=3600");

      downloadResponse.readableStreamBody.pipe(res);
    }
  } catch (err: any) {
    if (err?.statusCode === 404) return res.status(404).json({ error: "Not found" });
    return res.status(500).json({ error: "Failed to fetch blob", detail: String(err) });
  }
});

export default router;
