#!/usr/bin/env node
/* Prepares the minified front-end mirror used by the Node web server.
 * Run during deployment builds so production startup can listen without minifying assets. */
import { prepareWebAssets } from '../server/src/web-assets.js';

const result = await prepareWebAssets();
console.log(`[build] front-end minified (${result.files} files, −${(result.saved / 1024).toFixed(0)} KB)`);
