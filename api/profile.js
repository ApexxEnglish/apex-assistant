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

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({
      error: 'Supabase environment variables are missing.'
    });
  }

  const body = req.body || {};
  const action = body.action;

  const email = String(body.email || '')
    .trim()
    .toLowerCase();

  if (!email || !email.includes('@')) {
    return res.status(400).json({
      error: 'Valid email is required.'
    });
  }

  const endpoint =
    `${SUPABASE_URL}/rest/v1/apex_learning_profiles`;

  const baseHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SECRET_KEY
  };

  try {

    // ==========================================
    // SAVE / UPDATE PROFILE
    // ==========================================
    if (action === 'save') {
      const profile = body.profile || {};

      const payload = {
        email,
        level: profile.level || null,
        next_goal: profile.nextGoal || '',
        common_mistakes: Array.isArray(profile.commonMistakes)
          ? profile.commonMistakes
          : [],
        words_phrases: Array.isArray(profile.wordsPhrases)
          ? profile.wordsPhrases
          : [],
        strengths: Array.isArray(profile.strengths)
          ? profile.strengths
          : [],
        speaking_count: Number(profile.speakingCount || 0),
        last_lesson_at: profile.lastLessonAt || null,
        linked_at: profile.linkedAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const response = await fetch(
        `${endpoint}?on_conflict=email`,
        {
          method: 'POST',
          headers: {
            ...baseHeaders,
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          body: JSON.stringify(payload)
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error('Supabase save error:', data);

        return res.status(response.status).json({
          error: 'Failed to save profile.',
          details: data
        });
      }

      return res.status(200).json({
        ok: true,
        profile: data?.[0] || null
      });
    }

    // ==========================================
    // LOAD PROFILE
    // ==========================================
    if (action === 'load') {
      const response = await fetch(
        `${endpoint}?email=eq.${encodeURIComponent(email)}&select=*`,
        {
          method: 'GET',
          headers: baseHeaders
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error('Supabase load error:', data);

        return res.status(response.status).json({
          error: 'Failed to load profile.',
          details: data
        });
      }

      if (!Array.isArray(data) || data.length === 0) {
        return res.status(404).json({
          error: 'Profile not found.'
        });
      }

      const row = data[0];

      return res.status(200).json({
        ok: true,

        profile: {
          email: row.email,
          level: row.level,
          nextGoal: row.next_goal || '',
          commonMistakes: row.common_mistakes || [],
          wordsPhrases: row.words_phrases || [],
          strengths: row.strengths || [],
          speakingCount: row.speaking_count || 0,
          linkedAt: row.linked_at,
          lastLessonAt: row.last_lesson_at,
          updatedAt: row.updated_at
        }
      });
    }

    return res.status(400).json({
      error: 'Invalid action.'
    });

  } catch (err) {
    console.error('Profile API error:', err);

    return res.status(500).json({
      error: 'Profile service failed.'
    });
  }
}
