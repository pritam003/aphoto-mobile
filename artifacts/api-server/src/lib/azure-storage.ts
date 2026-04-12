import { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions } from "@azure/storage-blob";
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
  if (process.env.NODE_ENV !== "production") {
    // Dev: use proxy route (Vite forwards /api/blobs/* with cookies)
    return `/api/blobs/${blobName}`;
  }

  // Production: generate a user-delegation SAS URL so the browser can fetch
  // the image directly from Blob Storage without needing an auth cookie.
  const client = getBlobServiceClient();
  const startsOn = new Date();
  const expiresOn = new Date(startsOn.getTime() + expiresInSeconds * 1000);

  const userDelegationKey = await client.getUserDelegationKey(startsOn, expiresOn);

  const sasParams = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
    },
    userDelegationKey,
    accountName,
  );

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasParams.toString()}`;
}

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}
