import path from 'node:path';
import { createRequire } from 'node:module';
export function preview(appRoot, port) {
  const require = createRequire(path.join(appRoot, 'package.json'));
  const express = require('express');
  const { createProxyMiddleware } = require('http-proxy-middleware');
  const app = express();
  const proxy = createProxyMiddleware({ target: process.env.BACKEND_URL || 'http://127.0.0.1:3000', changeOrigin: true });
  app.use((req, res, next) => /^\/(api|media)(\/|$)/.test(req.url) ? proxy(req, res, next) : next());
  app.use(express.static(path.join(appRoot, 'www'), { dotfiles: 'deny' }));
  app.listen(port, '0.0.0.0', () => console.log(`App preview on ${port}, API requests proxied to backend`));
}
