/* Admin API client. The session token is the same one the public site stores, so being signed in there is enough. */
const KEY = 'ab.token';
export const getToken = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
export const setToken = (t) => { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY); };

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const authLost = (err) => window.dispatchEvent(new CustomEvent('admin:auth', { detail: err }));

async function send(method, path, { body, raw, headers = {}, base = '/api/v1/admin' } = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch { throw new ApiError(0, 'Can’t reach the server. Check your connection.', 'network'); }
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json().catch(() => ({})) : res;
  if (!res.ok) {
    const e = new ApiError(res.status, data?.error?.message || `Request failed (${res.status})`, data?.error?.code);
    if (base.endsWith('/admin') && (res.status === 401 || (res.status === 403 && ['forbidden', 'account_disabled'].includes(e.code)))) authLost(e);
    throw e;
  }
  return data;
}

export const api = {
  get: (p) => send('GET', p),
  post: (p, body = {}) => send('POST', p, { body }),
  put: (p, body = {}) => send('PUT', p, { body }),
  patch: (p, body = {}) => send('PATCH', p, { body }),
  del: (p) => send('DELETE', p),
  /** Signs in with email + password on the public auth endpoint (the same account as on the site). */
  async login(email, password) {
    const r = await send('POST', '/auth/login', { body: { email, password }, base: '/api/v1' });
    setToken(r.token); return r;
  },
  /** Authenticated file download (PDF invoices, CSV register). */
  async download(path, filename) {
    const res = await send('GET', path);          // returns the Response for non-JSON bodies
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
  /** Uploads an image (already resized by prepareImage) → { path }. */
  uploadImage: (blob) => send('POST', '/uploads/image', { raw: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } }),
};

/** PUT a big file straight to R2 with progress (XHR: fetch has no upload progress). */
export function putFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', file.type || 'video/mp4');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new ApiError(x.status, `Storage refused the upload (${x.status}). Check the R2 token allows writes and the bucket CORS allows PUT from this site.`, 'r2_upload')));
    x.onerror = () => reject(new ApiError(0, 'Upload failed — most likely the R2 bucket CORS policy doesn’t allow PUT from this site (see docs/ADMIN.md).', 'r2_cors'));
    x.send(file);
  });
}

/** Shrinks/re-encodes an image in the browser (WebP) so uploads stay small; GIFs and tiny files are sent as they are. */
export async function prepareImage(file, { maxWidth = 1600, quality = 0.86 } = {}) {
  if (!file.type.startsWith('image/')) throw new ApiError(400, 'Choose an image file.');
  if (file.type === 'image/gif' || file.size < 40_000 && file.type === 'image/webp') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, maxWidth / bmp.width), w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/webp', quality));
  return blob && blob.type === 'image/webp' && blob.size < file.size ? blob : file;
}
