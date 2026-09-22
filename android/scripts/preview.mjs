import { fileURLToPath } from 'node:url';
import { preview } from '../../shared/mobile-preview.mjs';
preview(fileURLToPath(new URL('..', import.meta.url)), 3001);
