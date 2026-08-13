import crypto from 'crypto';
import nodemailer from 'nodemailer';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
    GMAIL_APP_PASSWORD
  } = process.env;

  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY ||
    !GMAIL_USER ||
    !GMAIL_APP_PASSWORD
  ) {
    return res.status(500).json({
      error: 'Required environment variables are missing.'
    });
  }

  const body = req.body || {};
  const action = body.action;
  const email = normalizeEmail(body.email);

  if (!email || !email.includes('@')) {
    return res.status(400).json({
      error: 'Valid email is required.'
    });
  }

  const supabaseHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SECRET_KEY
  };

  const verificationEndpoint =
    `${SUPABASE_URL}/rest/v1/apex_profile_verifications`;

  try {

    // ==================================================
    // SEND 6-DIGIT CODE
    // ==================================================
    if (action === 'send') {
      const code = generateCode();
      const codeHash = hashCode(email, code);

      const expiresAt = new Date(
        Date.now() + 10 * 60 * 1000
      ).toISOString();

      // Delete older unused codes for this email
      await fetch(
        `${verificationEndpoint}?email=eq.${encodeURIComponent(email)}&verified_at=is.null`,
        {
          method: 'DELETE',
          headers: supabaseHeaders
        }
      );

      const saveResponse = await fetch(
        verificationEndpoint,
        {
          method: 'POST',
          headers: {
            ...supabaseHeaders,
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({
            email,
            code_hash: codeHash,
            expires_at: expiresAt
          })
        }
      );

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json().catch(() => ({}));

        console.error('Supabase verification save error:', errorData);

        return res.status(500).json({
          error: 'Verification code could not be saved.'
        });
      }

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: GMAIL_USER,
          pass: GMAIL_APP_PASSWORD
        }
      });

      await transporter.sendMail({
        from: GMAIL_USER,
        to: email,

        subject: 'Apex Assistant — Doğrulama Kodunuz',

        text:
          `Apex Assistant doğrulama kodunuz:\n\n` +
          `${code}\n\n` +
          `Bu kod 10 dakika geçerlidir.\n\n` +
          `Bu işlemi siz başlatmadıysanız bu e-postayı yok sayabilirsiniz.`
      });

      return res.status(200).json({
        ok: true,
        message: 'Verification code sent.'
      });
    }

    // ==================================================
    // VERIFY CODE
    // ==================================================
    if (action === 'verify') {
      const code = String(body.code || '').trim();

      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({
          error: 'A valid 6-digit code is required.'
        });
      }

      const response = await fetch(
        `${verificationEndpoint}` +
        `?email=eq.${encodeURIComponent(email)}` +
        `&verified_at=is.null` +
        `&order=created_at.desc` +
        `&limit=1` +
        `&select=id,code_hash,expires_at`,
        {
          method: 'GET',
          headers: supabaseHeaders
        }
      );

      const rows = await response.json();

      if (!response.ok) {
        console.error('Supabase verification lookup error:', rows);

        return res.status(500).json({
          error: 'Verification lookup failed.'
        });
      }

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({
          error: 'No active verification code found.'
        });
      }

      const verification = rows[0];

      if (
        !verification.expires_at ||
        new Date(verification.expires_at).getTime() < Date.now()
      ) {
        return res.status(400).json({
          error: 'Verification code expired.'
        });
      }

      const submittedHash = hashCode(email, code);

      const storedBuffer = Buffer.from(
        verification.code_hash,
        'utf8'
      );

      const submittedBuffer = Buffer.from(
        submittedHash,
        'utf8'
      );

      const isValid =
        storedBuffer.length === submittedBuffer.length &&
        crypto.timingSafeEqual(
          storedBuffer,
          submittedBuffer
        );

      if (!isValid) {
        return res.status(400).json({
          error: 'Verification code is incorrect.'
        });
      }

      const markResponse = await fetch(
        `${verificationEndpoint}?id=eq.${encodeURIComponent(verification.id)}`,
        {
          method: 'PATCH',
          headers: {
            ...supabaseHeaders,
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({
            verified_at: new Date().toISOString()
          })
        }
      );

      if (!markResponse.ok) {
        return res.status(500).json({
          error: 'Verification could not be completed.'
        });
      }

      return res.status(200).json({
        ok: true,
        verified: true,
        email
      });
    }

    return res.status(400).json({
      error: 'Invalid action.'
    });

  } catch (err) {
    console.error('Verify API error:', err);

    return res.status(500).json({
      error: 'Verification service failed.'
    });
  }
}
