import { fileURLToPath } from 'node:url';
import { buildMobile } from '../../shared/build-mobile.mjs';
await buildMobile(fileURLToPath(new URL('..', import.meta.url)), 'iOS', { native: process.argv.includes('--native') });
