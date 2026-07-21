// Server-side R2 (S3-compatible) access for Next.js API routes — TypeScript
// counterpart to scripts/lib/r2.js (which the CLI import script uses; kept
// separate since that script runs standalone via plain Node, not through
// Next's build). Used for admin config (config/admin.json) and the login
// rate-limit ledger — small JSON blobs, not the product images/catalogue.
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in the environment.`);
  return v;
}

function accountEndpoint(): string {
  // The Cloudflare dashboard sometimes shows the endpoint with the bucket
  // name already appended. The S3 SDK adds the bucket separately via the
  // Bucket param on every request, so a path component here would double it
  // up and break every request — strip back to the bare account host.
  const raw = requiredEnv("R2_ACCOUNT_ENDPOINT");
  const url = new URL(raw);
  return `${url.protocol}//${url.host}`;
}

let cachedClient: S3Client | null = null;
function client(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: accountEndpoint(),
      forcePathStyle: true,
      credentials: {
        accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return cachedClient;
}

async function streamToString(stream: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads and parses a JSON object from R2. Returns null if the key doesn't exist. */
export async function r2GetJson<T>(key: string): Promise<T | null> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: requiredEnv("R2_BUCKET"), Key: key }));
    const text = await streamToString(res.Body);
    return JSON.parse(text) as T;
  } catch (err: unknown) {
    const e = err as { $metadata?: { httpStatusCode?: number }; name?: string };
    if (e.$metadata?.httpStatusCode === 404 || e.name === "NoSuchKey") return null;
    throw err;
  }
}

/** Writes a JSON object to R2, overwriting whatever was there. */
export async function r2PutJson(key: string, data: unknown): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: requiredEnv("R2_BUCKET"),
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: "application/json",
    })
  );
}

/** True if an object already exists at this key — used to skip re-uploading unchanged images. */
export async function r2ObjectExists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: requiredEnv("R2_BUCKET"), Key: key }));
    return true;
  } catch (err: unknown) {
    const e = err as { $metadata?: { httpStatusCode?: number }; name?: string };
    if (e.$metadata?.httpStatusCode === 404 || e.name === "NotFound") return false;
    throw err;
  }
}

/** A short-lived presigned PUT URL for one object key — the browser uploads directly to R2 with this, the file never touches the server. */
export async function r2PresignedPutUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
  const command = new PutObjectCommand({ Bucket: requiredEnv("R2_BUCKET"), Key: key, ContentType: contentType });
  return getSignedUrl(client(), command, { expiresIn: expiresInSeconds });
}
