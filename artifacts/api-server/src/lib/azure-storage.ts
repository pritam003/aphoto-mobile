import { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions, UserDelegationKey } from "@azure/storage-blob";
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

// Cache the user delegation key — valid for up to 7 days, refresh 10 min before expiry
let _delegationKey: UserDelegationKey | null = null;
let _delegationKeyExpiry: Date | null = null;

async function getUserDelegationKey(expiresOn: Date): Promise<UserDelegationKey> {
  const now = new Date();
  const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000);
  if (_delegationKey && _delegationKeyExpiry && _delegationKeyExpiry > tenMinutesFromNow) {
    return _delegationKey;
  }
  const keyExpiry = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6hr key
  _delegationKey = await getBlobServiceClient().getUserDelegationKey(now, keyExpiry);
  _delegationKeyExpiry = keyExpiry;
  return _delegationKey;
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

export async function generateSasUrl(blobName: string, expiresInSeconds = 86400): Promise<string> {
  if (process.env.NODE_ENV !== "production") {
    return `/api/blobs/${blobName}`;
  }

  const startsOn = new Date();
  const expiresOn = new Date(startsOn.getTime() + expiresInSeconds * 1000);
  const userDelegationKey = await getUserDelegationKey(expiresOn);

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

// Generate a write-only SAS URL so the browser can upload directly to Blob Storage
// without routing the file bytes through the API.
export async function generateUploadSasUrl(blobName: string, contentType: string): Promise<string> {
  if (process.env.NODE_ENV !== "production") {
    // In dev the browser upload goes through the API proxy (handled in photos route)
    return "";
  }

  const startsOn = new Date();
  const expiresOn = new Date(startsOn.getTime() + 30 * 60 * 1000); // 30 min to complete upload
  const userDelegationKey = await getUserDelegationKey(expiresOn);

  const sasParams = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("cw"), // create + write
      startsOn,
      expiresOn,
      contentType,
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
