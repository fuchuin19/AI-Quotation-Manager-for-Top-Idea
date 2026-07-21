const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');

const PRODUCTS_KEY = 'catalog/products.json';

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing ${name} in .env.local. Fill in the R2 credentials before running the import (see .env.local in the project root).`
    );
  }
  return v;
}

function accountEndpoint() {
  // The Cloudflare dashboard sometimes shows the endpoint with the bucket
  // name already appended (e.g. for rclone-style tools). The S3 SDK adds the
  // bucket separately via the Bucket param on every request, so any path
  // component here would double it up and break every request. Strip it back
  // to the bare account host.
  const raw = requiredEnv('R2_ACCOUNT_ENDPOINT');
  const url = new URL(raw);
  return `${url.protocol}//${url.host}`;
}

function makeClient() {
  return new S3Client({
    region: 'auto',
    endpoint: accountEndpoint(),
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function publicUrlFor(key) {
  const base = requiredEnv('R2_PUBLIC_URL').replace(/\/+$/, '');
  return `${base}/${key}`;
}

async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return false;
    throw err;
  }
}

async function uploadImageIfMissing(client, bucket, key, buffer, contentType) {
  const exists = await objectExists(client, bucket, key);
  if (exists) return { uploaded: false, url: publicUrlFor(key) };
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType })
  );
  return { uploaded: true, url: publicUrlFor(key) };
}

async function getProductsJson(client, bucket) {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: PRODUCTS_KEY }));
    const buf = await streamToBuffer(res.Body);
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchKey') return null;
    throw err;
  }
}

async function putProductsJson(client, bucket, products) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: PRODUCTS_KEY,
      Body: JSON.stringify(products, null, 2),
      ContentType: 'application/json',
    })
  );
}

module.exports = {
  PRODUCTS_KEY,
  makeClient,
  publicUrlFor,
  objectExists,
  uploadImageIfMissing,
  getProductsJson,
  putProductsJson,
};
