import { Router } from "express";
import { getContainerClient } from "../lib/azure-storage.js";

const router = Router();

// Proxy blob downloads — authenticates via DefaultAzureCredential, no SAS or account key needed
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
    const downloadResponse = await blobClient.download();

    if (!downloadResponse.readableStreamBody) {
      return res.status(404).json({ error: "Blob not found" });
    }

    res.setHeader("Content-Type", downloadResponse.contentType || "application/octet-stream");
    if (downloadResponse.contentLength) {
      res.setHeader("Content-Length", downloadResponse.contentLength);
    }
    res.setHeader("Cache-Control", "private, max-age=3600");

    downloadResponse.readableStreamBody.pipe(res);
  } catch (err: any) {
    if (err?.statusCode === 404) return res.status(404).json({ error: "Not found" });
    return res.status(500).json({ error: "Failed to fetch blob", detail: String(err) });
  }
});

export default router;
