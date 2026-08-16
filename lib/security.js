const buckets = new Map();

export function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwarded || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
}

function getRequestHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function getRequestProto(req) {
  return String(req.headers['x-forwarded-proto'] || 'https')
    .split(',')[0]
    .trim()
    .toLowerCase();
}

export function applyCors(req, res) {
  const origin = String(req.headers.origin || '').trim();
  const host = getRequestHost(req);
  const proto = getRequestProto(req);

  const configured = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  const allowedOrigins = new Set([
    'https://apexenglish.net',
    'https://www.apexenglish.net',
    ...configured
  ]);

  const sameOrigin = Boolean(origin && host && (
    origin === `${proto}://${host}` ||
    origin === `https://${host}` ||
    origin === `http://${host}`
  ));

  // Browser requests from Apex and same-origin Vercel deployments are allowed.
  // Requests without Origin are not treated as trusted, but are left available
  // for server-to-server / tooling compatibility and remain rate-limited.
  const allowed = !origin || sameOrigin || allowedOrigins.has(origin);

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  return allowed;
}

export function enforceRateLimit(req, res, {
  scope,
  max,
  windowMs,
  message = 'Too many requests. Please try again later.'
}) {
  const now = Date.now();
  const ip = getClientIp(req);
  const key = `${scope}:${ip}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    current.count += 1;
    if (current.count > max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: message });
      return false;
    }
  }

  // Best-effort cleanup for warm serverless instances.
  if (buckets.size > 5000) {
    for (const [bucketKey, value] of buckets.entries()) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  return true;
}

export function cleanText(value, maxChars = 4000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxChars);
}

export function isValidEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
