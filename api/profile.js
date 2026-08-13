import crypto from 'crypto';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function base64urlDecode(value) {
  let input = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  while (input.length % 4) {
    input += '=';
  }

  return Buffer.from(input, 'base64').toString('utf8');
}

function verifySessionToken(token, expectedEmail, secret) {
  try {
    if (!token || !secret) {
      return false;
    }

    const parts = String(token).split('.');

    if (parts.length !== 2) {
      return false;
    }

    const [encodedPayload, suppliedSignature] = parts;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    const suppliedBuffer = Buffer.from(
      suppliedSignature,
      'utf8'
    );

    const expectedBuffer = Buffer.from(
      expectedSignature,
      'utf8'
    );

    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(
        suppliedBuffer,
        expectedBuffer
      )
    ) {
      return false;
    }

    const payload = JSON.parse(
      base64urlDecode(encodedPayload)
    );

    const tokenEmail = normalizeEmail(payload.email);

    if (!tokenEmail || tokenEmail !== expectedEmail) {
      return false;
    }

    if (
      !payload.exp ||
      Number(payload.exp) < Date.now()
    ) {
      return false;
    }

    return true;

  } catch (err) {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type'
  );

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const {
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    PROFILE_SESSION_SECRET
  } = process.env;

  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY ||
    !PROFILE_SESSION_SECRET
  ) {
    return res.status(500).json({
      error:
        'Required server environment variables are missing.'
    });
  }

  const body = req.body || {};
  const action = body.action;

  const email = normalizeEmail(body.email);
  const sessionToken = String(
    body.sessionToken || ''
  ).trim();

  if (!email || !email.includes('@')) {
    return res.status(400).json({
      error: 'Valid email is required.'
    });
  }

  // ==========================================
  // SECURITY CHECK
  // ==========================================
  const authorized = verifySessionToken(
    sessionToken,
    email,
    PROFILE_SESSION_SECRET
  );

  if (!authorized) {
    return res.status(401).json({
      error:
        'Email verification is required or the session has expired.'
    });
  }

  const endpoint =
    `${SUPABASE_URL}/rest/v1/apex_learning_profiles`;

  const baseHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SECRET_KEY
  };

  try {

    // ==========================================
    // SAVE / UPDATE PROFILE
    // ==========================================
    if (action === 'save') {
      const profile = body.profile || {};

      const payload = {
        email,

        level:
          profile.level || null,

        next_goal:
          profile.nextGoal || '',

        common_mistakes:
          Array.isArray(profile.commonMistakes)
            ? profile.commonMistakes.slice(0, 30)
            : [],

        words_phrases:
          Array.isArray(profile.wordsPhrases)
            ? profile.wordsPhrases.slice(0, 50)
            : [],

        strengths:
          Array.isArray(profile.strengths)
            ? profile.strengths.slice(0, 30)
            : [],

        speaking_count:
          Math.max(
            0,
            Number(profile.speakingCount || 0)
          ),

        last_lesson_at:
          profile.lastLessonAt || null,

        linked_at:
          profile.linkedAt ||
          new Date().toISOString(),

        updated_at:
          new Date().toISOString()
      };

      const response = await fetch(
        `${endpoint}?on_conflict=email`,
        {
          method: 'POST',

          headers: {
            ...baseHeaders,
            Prefer:
              'resolution=merge-duplicates,return=representation'
          },

          body: JSON.stringify(payload)
        }
      );

      const data =
        await response.json().catch(() => null);

      if (!response.ok) {
        console.error(
          'Supabase save error:',
          data
        );

        return res.status(
          response.status
        ).json({
          error: 'Failed to save profile.'
        });
      }

      const saved = data?.[0] || null;

      return res.status(200).json({
        ok: true,

        profile: saved
          ? {
              email: saved.email,
              level: saved.level,
              nextGoal:
                saved.next_goal || '',
              commonMistakes:
                saved.common_mistakes || [],
              wordsPhrases:
                saved.words_phrases || [],
              strengths:
                saved.strengths || [],
              speakingCount:
                saved.speaking_count || 0,
              linkedAt:
                saved.linked_at,
              lastLessonAt:
                saved.last_lesson_at,
              updatedAt:
                saved.updated_at
            }
          : null
      });
    }

    // ==========================================
    // LOAD PROFILE
    // ==========================================
    if (action === 'load') {

      const response = await fetch(
        `${endpoint}` +
        `?email=eq.${encodeURIComponent(email)}` +
        `&select=*`,
        {
          method: 'GET',
          headers: baseHeaders
        }
      );

      const data =
        await response.json().catch(() => null);

      if (!response.ok) {
        console.error(
          'Supabase load error:',
          data
        );

        return res.status(
          response.status
        ).json({
          error: 'Failed to load profile.'
        });
      }

      if (
        !Array.isArray(data) ||
        data.length === 0
      ) {
        return res.status(404).json({
          error: 'Profile not found.'
        });
      }

      const row = data[0];

      return res.status(200).json({
        ok: true,

        profile: {
          email: row.email,

          level:
            row.level,

          nextGoal:
            row.next_goal || '',

          commonMistakes:
            row.common_mistakes || [],

          wordsPhrases:
            row.words_phrases || [],

          strengths:
            row.strengths || [],

          speakingCount:
            row.speaking_count || 0,

          linkedAt:
            row.linked_at,

          lastLessonAt:
            row.last_lesson_at,

          updatedAt:
            row.updated_at
        }
      });
    }

    return res.status(400).json({
      error: 'Invalid action.'
    });

  } catch (err) {
    console.error(
      'Profile API error:',
      err
    );

    return res.status(500).json({
      error: 'Profile service failed.'
    });
  }
}
