// Fetch wrapper. Adds the anti-CSRF header, turns errors into exceptions, and when the
// server says a passport check is needed, prompts for the passport image and retries once.
export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `Request failed (${status})`); this.status = status; this.body = body || {}; }
}

let passportPrompt = null;
export const setPassportPrompt = (fn) => { passportPrompt = fn; };

async function request(method, url, body, { retry = true } = {}) {
  const opts = { method, headers: { 'X-Nation-Request': '1' }, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (res.ok) return data;
  const err = new ApiError(res.status, data);
  if (retry && err.body.need === 'passport' && passportPrompt) {
    if (await passportPrompt()) return request(method, url, body, { retry: false });
  }
  throw err;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};
