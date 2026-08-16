import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { applyCors, enforceRateLimit, isValidEmail } from '../lib/security.js';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashCode(email, code) {
  return crypto
    .createHash('sha256')
    .update(`${email}:${code}`)
    .digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function base64url(value) {
  return Buffer
    .from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createSessionToken(email, secret) {
  const payload = {
    email,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  };

  const encodedPayload = base64url(JSON.stringify(payload));

  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return `${encodedPayload}.${signature}`;
}

function verificationEmailHtml(code) {
  return `
  <!doctype html>
  <html lang="tr">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Apex English Doğrulama Kodu</title>
    </head>
    <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#102b55;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;padding:28px 12px;">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e7ed;border-radius:16px;overflow:hidden;">
            <tr><td style="background:#102b55;padding:22px 26px;">
              <div style="font-size:20px;line-height:1.2;font-weight:700;color:#ffffff;">Apex English</div>
              <div style="margin-top:5px;font-size:12px;line-height:1.4;color:#d7b25a;letter-spacing:.04em;">ÖĞRENME PROFİLİ DOĞRULAMA</div>
            </td></tr>
            <tr><td style="padding:28px 26px 10px;">
              <h1 style="margin:0;font-size:22px;line-height:1.35;color:#102b55;font-weight:700;">Doğrulama Kodunuz</h1>
              <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#526075;">Apex English öğrenme profilinizi doğrulamak ve ilerlemenizi güvenli şekilde kaydetmek için aşağıdaki 6 haneli kodu kullanın.</p>
            </td></tr>
            <tr><td align="center" style="padding:18px 26px;">
              <div style="display:inline-block;min-width:220px;padding:18px 24px;background:#f8f3e6;border:1px solid #e4cf93;border-radius:14px;color:#102b55;font-size:32px;line-height:1;font-weight:800;letter-spacing:8px;text-align:center;">${code}</div>
            </td></tr>
            <tr><td style="padding:8px 26px 26px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#526075;">Bu kod <strong style="color:#102b55;">10 dakika</strong> geçerlidir.</p>
              <p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:#526075;">Bu işlemi siz başlatmadıysanız bu e-postayı güvenle yok sayabilirsiniz.</p>
            </td></tr>
            <tr><td style="border-top:1px solid #e7ebef;padding:18px 26px 22px;background:#fbfcfd;">
              <div style="font-size:12px;line-height:1.55;color:#7a8594;">Bu e-posta Apex English doğrulama sistemi tarafından otomatik olarak gönderilmiştir.</div>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`;
}

function verificationEmailText(code) {
  return [
    'Apex English', '', 'Doğrulama Kodunuz', '', `Kod: ${code}`, '',
    'Bu kod 10 dakika geçerlidir.', '',
    'Bu işlemi siz başlatmadıysanız bu e-postayı yok sayabilirsiniz.'
  ].join('\n');
}

export default async function handler(req, res) {
  const originAllowed = applyCors(req, res);
  if (!originAllowed) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    GMAIL_USER,
    GMAIL_APP_PASSWORD,
    PROFILE_SESSION_SECRET
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD || !PROFILE_SESSION_SECRET) {
    return res.status(500).json({ error: 'Required environment variables are missing.' });
  }

  const body = req.body || {};
  const action = String(body.action || '');
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email is required.' });
  }

  if (action === 'send') {
    if (!enforceRateLimit(req, res, {
      scope: 'verify-send-10m',
      max: 5,
      windowMs: 10 * 60 * 1000,
      message: 'Too many verification emails requested. Please wait before trying again.'
    })) return;

    if (!enforceRateLimit(req, res, {
      scope: 'verify-send-day',
      max: 25,
      windowMs: 24 * 60 * 60 * 1000,
      message: 'Daily verification email limit reached.'
    })) return;
  } else if (action === 'verify') {
    if (!enforceRateLimit(req, res, {
      scope: 'verify-code-10m',
      max: 12,
      windowMs: 10 * 60 * 1000,
      message: 'Too many verification attempts. Please wait and try again.'
    })) return;
  } else {
    return res.status(400).json({ error: 'Invalid action.' });
  }

  const supabaseHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SECRET_KEY
  };

  const verificationEndpoint = `${SUPABASE_URL}/rest/v1/apex_profile_verifications`;

  try {
    if (action === 'send') {
      const code = generateCode();
      const codeHash = hashCode(email, code);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await fetch(
        `${verificationEndpoint}?email=eq.${encodeURIComponent(email)}&verified_at=is.null`,
        { method: 'DELETE', headers: supabaseHeaders }
      );

      const saveResponse = await fetch(verificationEndpoint, {
        method: 'POST',
        headers: { ...supabaseHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ email, code_hash: codeHash, expires_at: expiresAt })
      });

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json().catch(() => ({}));
        console.error('Supabase verification save error:', errorData);
        return res.status(500).json({ error: 'Verification code could not be saved.' });
      }

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
      });

      await transporter.sendMail({
        from: `"Apex English" <${GMAIL_USER}>`,
        to: email,
        subject: 'Apex English | Doğrulama Kodunuz',
        text: verificationEmailText(code),
        html: verificationEmailHtml(code)
      });

      return res.status(200).json({ ok: true, message: 'Verification code sent.' });
    }

    const code = String(body.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'A valid 6-digit code is required.' });
    }

    const response = await fetch(
      `${verificationEndpoint}?email=eq.${encodeURIComponent(email)}&verified_at=is.null&order=created_at.desc&limit=1&select=id,code_hash,expires_at`,
      { method: 'GET', headers: supabaseHeaders }
    );

    const rows = await response.json();
    if (!response.ok) {
      console.error('Supabase verification lookup error:', rows);
      return res.status(500).json({ error: 'Verification lookup failed.' });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No active verification code found.' });
    }

    const verification = rows[0];
    if (!verification.expires_at || new Date(verification.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification code expired.' });
    }

    const submittedHash = hashCode(email, code);
    const storedBuffer = Buffer.from(verification.code_hash, 'utf8');
    const submittedBuffer = Buffer.from(submittedHash, 'utf8');
    const valid = storedBuffer.length === submittedBuffer.length &&
      crypto.timingSafeEqual(storedBuffer, submittedBuffer);

    if (!valid) {
      return res.status(400).json({ error: 'Verification code is incorrect.' });
    }

    const markResponse = await fetch(
      `${verificationEndpoint}?id=eq.${encodeURIComponent(verification.id)}`,
      {
        method: 'PATCH',
        headers: { ...supabaseHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ verified_at: new Date().toISOString() })
      }
    );

    if (!markResponse.ok) {
      return res.status(500).json({ error: 'Verification could not be completed.' });
    }

    const sessionToken = createSessionToken(email, PROFILE_SESSION_SECRET);
    return res.status(200).json({ ok: true, verified: true, email, sessionToken });
  } catch (err) {
    console.error('Verify API error:', err);
    return res.status(500).json({ error: 'Verification service failed.' });
  }
}
