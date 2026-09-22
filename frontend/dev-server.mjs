// Browser requests remain relative; only this Node proxy contacts the backend.
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'node:url';
const app = express();
const proxy = createProxyMiddleware({ target: process.env.BACKEND_URL || 'http://127.0.0.1:3000', changeOrigin: true });
app.use((req, res, next) => /^\/(api|media)(\/|$)/.test(req.url) ? proxy(req, res, next) : next());
for (const name of ['assets', 'components']) app.use('/' + name, express.static(fileURLToPath(new URL(name, import.meta.url)), { dotfiles: 'deny', index: false }));
app.use('/shared', express.static(fileURLToPath(new URL('../shared', import.meta.url)), { dotfiles: 'deny', index: false }));
app.get(['/', '/index.html'], (_req, res) => res.sendFile(fileURLToPath(new URL('index.html', import.meta.url))));
app.listen(Number(process.env.PORT || 5173), '0.0.0.0', () => console.log(`Frontend on ${process.env.PORT || 5173}; /api and /media proxied to backend`));
