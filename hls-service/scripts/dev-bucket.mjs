#!/usr/bin/env node
/**
 * A throw-away, in-memory stand-in for Cloudflare R2 — for trying the whole flow on your own machine
 * before you touch a real bucket. It speaks enough S3 (presigned PUT/GET/HEAD/DELETE + ListObjectsV2)
 * and verifies every request signature, exactly like R2 would.
 *
 *   node scripts/dev-bucket.mjs 9100
 *
 *   # in another terminal, run the converter against it:
 *   R2_ACCOUNT_ID=dev R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev \
 *   R2_BUCKET=addabaaz-dev R2_ENDPOINT=http://127.0.0.1:9100 npm start
 *
 * Then use the portal as usual: jobs upload into this fake bucket and “Test R2” passes. Objects live in
 * memory only and vanish when you stop it. NEVER point a real deployment at this.
 */
import { startFakeS3 } from '../test/helpers/fake-s3.mjs';

const port = Number(process.argv[2]) || 9100;
const bucket = process.env.BUCKET || 'addabaaz-dev';
// The same three values you give the converter (they default to the “dev” trio printed below).
const accessKeyId = process.env.R2_ACCESS_KEY_ID || 'dev';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || 'dev';
const s3 = await startFakeS3({
  bucket, port, accessKeyId, secretAccessKey,
  onRequest: (r) => console.log(`  ${r.method.padEnd(6)} ${r.key || r.path}${r.signed ? '' : '   ✖ bad signature'}`),
});

console.log(`Dev R2 bucket on http://127.0.0.1:${port}  (bucket “${bucket}”)`);
console.log('Objects are kept in memory and disappear on exit. Requests are listed below.\n');
console.log('Start the converter with:');
console.log(`  R2_ACCOUNT_ID=dev R2_ACCESS_KEY_ID=${accessKeyId} R2_SECRET_ACCESS_KEY=${secretAccessKey} R2_BUCKET=${bucket} R2_ENDPOINT=http://127.0.0.1:${port} npm start\n`);

const bye = async () => { console.log(`\n${s3.objects.size} object(s) discarded.`); await s3.stop(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
