import { Client } from 'minio'
import { config } from './config.js'

function makeClient(endpoint: string): Client {
  const url = new URL(endpoint)
  return new Client({
    endPoint: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    useSSL: url.protocol === 'https:',
    accessKey: config.MINIO_ACCESS_KEY,
    secretKey: config.MINIO_SECRET_KEY,
  })
}

export const minio = makeClient(config.MINIO_ENDPOINT)

// presigned URLs are opened by browsers / Telegram, so they must be signed
// against a publicly reachable host, not the docker-internal one
export const minioPublic = config.MINIO_PUBLIC_ENDPOINT
  ? makeClient(config.MINIO_PUBLIC_ENDPOINT)
  : minio

export const CLIPS_BUCKET = config.MINIO_BUCKET_CLIPS

export async function ensureBucket(name: string): Promise<void> {
  if (!(await minio.bucketExists(name))) {
    await minio.makeBucket(name)
  }
}
