import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME!;

let blobServiceClient: BlobServiceClient;

function getBlobServiceClient(): BlobServiceClient {
  if (blobServiceClient) return blobServiceClient;

  const credential = new DefaultAzureCredential();
  blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential,
  );

  return blobServiceClient;
}

export function getContainerClient() {
  return getBlobServiceClient().getContainerClient(containerName);
}

export async function uploadBlob(
  blobName: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const containerClient = getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(data, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return blobName;
}

export async function deleteBlob(blobName: string): Promise<void> {
  const containerClient = getContainerClient();
  const blobClient = containerClient.getBlobClient(blobName);
  await blobClient.deleteIfExists();
}

export async function generateSasUrl(blobName: string, expiresInSeconds = 3600): Promise<string> {
  // Return a relative URL so it works through the Vite dev proxy (which carries the auth cookie).
  // In production the API and frontend are on the same origin, so relative URLs work there too.
  return `/api/blobs/${blobName}`;
}

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}
