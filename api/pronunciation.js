// Apex Assistant — Pronunciation Coach
// Receives a short mono WAV recording from the browser and asks Gemini
// to analyze the ACTUAL AUDIO. GEMINI_API_KEY stays server-side.

const MAX_BASE64_CHARS = 10_000_000; // comfortably below Gemini inline request limit for short clips

function cleanString(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch (_) {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) {}
  }

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch (_) {}
  }
  return null;
}

function normalizeResult(value, targetText) {
  const obj = value && typeof value === 'object' ? value : {};
  const clamp = n => Math.max(1, Math.min(5, Number(n) || 3));

  const focusWords = Array.isArray(obj.focusWords)
    ? obj.focusWords.slice(0, 4).map(item => ({
        word: cleanString(item?.word, 80),
        note: cleanString(item?.note, 240)
      })).filter(item => item.word)
    : [];

  return {
    clarity: clamp(obj.clarity),
    rhythm: clamp(obj.rhythm),
    stress: clamp(obj.stress),
    heard: cleanString(obj.heard, 500),
    focusWords,
    coachNote: cleanString(obj.coachNote, 900),
    tryAgain: cleanString(obj.tryAgain, 300) || targetText
  };
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY.' });
  }

  const {
    audioBase64,
    mimeType = 'audio/wav',
    targetText,
    uiLanguage = 'English',
    level = 'unknown'
  } = req.body || {};

  const audio = String(audioBase64 || '').trim();
  const target = cleanString(targetText, 240);
  const language = cleanString(uiLanguage, 80);
  const studentLevel = cleanString(level, 20);

  if (!audio || !target) {
    return res.status(400).json({ error: 'Audio and targetText are required.' });
  }

  if (mimeType !== 'audio/wav') {
    return res.status(400).json({ error: 'Only audio/wav is accepted by this endpoint.' });
  }

  if (audio.length > MAX_BASE64_CHARS) {
    return res.status(413).json({ error: 'Recording is too large.' });
  }

  const prompt = `
You are Apex English Pronunciation Coach.

You have ACTUAL AUDIO from an English learner plus the sentence they intended to say.

TARGET SENTENCE:
${target}

STUDENT LEVEL:
${studentLevel}

FEEDBACK LANGUAGE:
${language}

TASK:
Listen to the audio itself. Compare what is audibly spoken with the target sentence and provide practical English-pronunciation coaching.

IMPORTANT LIMITS:
- Do not claim laboratory-grade phonetic precision.
- Do not infer ethnicity, nationality, identity, health, disability, or personality from the voice.
- Do not score "accent quality" or tell the learner to erase their accent.
- Focus only on intelligibility, clarity, word stress, sentence stress, rhythm, pacing, and clearly audible pronunciation issues.
- If the audio does not support a specific phoneme-level claim, do not invent one.
- Keep feedback encouraging, concise, and actionable.
- Use the requested FEEDBACK LANGUAGE for notes, but keep English target words/phrases in English.
- Scores are coarse coaching ratings from 1 to 5, not percentages.

Return ONLY valid JSON in this exact shape:
{
  "clarity": 1,
  "rhythm": 1,
  "stress": 1,
  "heard": "brief transcript of what you actually heard",
  "focusWords": [
    {"word": "English word", "note": "short actionable note in the feedback language"}
  ],
  "coachNote": "2-4 concise sentences in the feedback language",
  "tryAgain": "one short English sentence to repeat"
}
`.trim();

  try {
    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: audio
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini pronunciation error:', data);
      return res.status(geminiResponse.status).json({
        error: data.error?.message || 'Gemini pronunciation API error.'
      });
    }

    const reply =
      data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('')
        .trim() || '';

    const parsed = extractJson(reply);
    if (!parsed) {
      console.error('Pronunciation JSON parse failed:', reply);
      return res.status(502).json({ error: 'Pronunciation response could not be parsed.' });
    }

    return res.status(200).json({
      ok: true,
      result: normalizeResult(parsed, target)
    });
  } catch (err) {
    console.error('Pronunciation service error:', err);
    return res.status(500).json({ error: 'Failed to analyze pronunciation.' });
  }
}
