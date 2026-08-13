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

function normalizeResult(value) {
  const obj = value && typeof value === 'object' ? value : {};
  const clamp = n => Math.max(1, Math.min(5, Number(n) || 3));

  const heard = cleanString(obj.heard, 500);
  const heardLower = heard.toLowerCase();

  const focusWords = Array.isArray(obj.focusWords)
    ? obj.focusWords.slice(0, 4).map(item => ({
        word: cleanString(item?.word, 80),
        note: cleanString(item?.note, 240)
      })).filter(item => item.word && heardLower.includes(item.word.toLowerCase()))
    : [];

  return {
    clarity: clamp(obj.clarity),
    rhythm: clamp(obj.rhythm),
    stress: clamp(obj.stress),
    heard,
    focusWords,
    coachNote: cleanString(obj.coachNote, 900),
    tryAgain: cleanString(obj.tryAgain, 300)
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
    referenceText,
    uiLanguage = 'English',
    level = 'unknown'
  } = req.body || {};

  const audio = String(audioBase64 || '').trim();
  const reference = cleanString(referenceText || targetText, 240);
  const language = cleanString(uiLanguage, 80);
  const studentLevel = cleanString(level, 20);

  if (!audio) {
    return res.status(400).json({ error: 'Audio is required.' });
  }

  if (mimeType !== 'audio/wav') {
    return res.status(400).json({ error: 'Only audio/wav is accepted by this endpoint.' });
  }

  if (audio.length > MAX_BASE64_CHARS) {
    return res.status(413).json({ error: 'Recording is too large.' });
  }

  const prompt = `
You are Apex English Pronunciation Coach.

You have an ACTUAL AUDIO recording from an English learner.

OPTIONAL EXAMPLE / REFERENCE TEXT:
${reference || '(none — the learner chose to speak freely)'}

STUDENT LEVEL:
${studentLevel}

FEEDBACK LANGUAGE:
${language}

MOST IMPORTANT RULE:
Analyze WHAT THE LEARNER ACTUALLY SAID IN THE AUDIO.
The optional reference text is only a practice suggestion. It is NOT authoritative.
If the learner says a different English sentence, do NOT penalize them for not matching the reference.
Do NOT force the reference sentence into the feedback.

TASK:
1. Listen to the audio and transcribe what you actually hear into "heard".
2. Evaluate pronunciation only for the words/sentence actually spoken.
3. Identify at most 1-3 clearly audible areas for improvement.
4. "focusWords" must come from words you actually heard in the recording.
5. "tryAgain" must be a SHORT TARGETED DRILL based on the clearest real issue you heard.
6. If the main issue is one word, create a short natural English sentence containing that word.
7. If the main issue involves rhythm/stress, create a short drill sentence that targets that exact rhythm/stress pattern.
8. Do NOT copy the optional reference sentence unless the learner actually said it and repeating it is genuinely the best drill.
9. If pronunciation is already strong and there is no clear issue, say so and give a slightly more challenging short sentence.

IMPORTANT LIMITS:
- Do not claim laboratory-grade phonetic precision.
- Do not infer ethnicity, nationality, identity, health, disability, or personality from the voice.
- Do not score "accent quality" or tell the learner to erase their accent.
- Focus only on intelligibility, clarity, word stress, sentence stress, rhythm, pacing, and clearly audible pronunciation issues.
- If the audio does not support a phoneme-level claim, do not invent one.
- Keep feedback encouraging, concise, and actionable.
- Use the requested FEEDBACK LANGUAGE for notes, but keep English words/phrases in English.
- Scores are coarse coaching ratings from 1 to 5, not percentages.
- Never invent a pronunciation problem just to produce a drill.

Return ONLY valid JSON in this exact shape:
{
  "clarity": 1,
  "rhythm": 1,
  "stress": 1,
  "heard": "brief transcript of what you actually heard",
  "focusWords": [
    {"word": "word actually heard in the audio", "note": "short actionable note in the feedback language"}
  ],
  "coachNote": "2-4 concise sentences in the feedback language",
  "tryAgain": "one short targeted English drill sentence based on the clearest audible issue"
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
      result: normalizeResult(parsed)
    });
  } catch (err) {
    console.error('Pronunciation service error:', err);
    return res.status(500).json({ error: 'Failed to analyze pronunciation.' });
  }
}
