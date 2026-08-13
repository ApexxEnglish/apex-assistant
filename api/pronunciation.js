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

function normalizeResult(value, sameFocusCount = 0, lastFocusWord = '') {
  const obj = value && typeof value === 'object' ? value : {};
  const clamp = n => Math.max(1, Math.min(5, Number(n) || 3));

  const heard = cleanString(obj.heard, 500);
  const heardLower = heard.toLowerCase();

  let focusWords = Array.isArray(obj.focusWords)
    ? obj.focusWords.slice(0, 2).map(item => ({
        word: cleanString(item?.word, 80),
        note: cleanString(item?.note, 180)
      })).filter(item => item.word && heardLower.includes(item.word.toLowerCase()))
    : [];

  if (sameFocusCount >= 2 && lastFocusWord) {
    focusWords = focusWords.filter(
      item => item.word.toLowerCase() !== lastFocusWord
    );
  }

  return {
    clarity: clamp(obj.clarity),
    rhythm: clamp(obj.rhythm),
    stress: clamp(obj.stress),
    heard,
    focusWords,
    coachNote: cleanString(obj.coachNote, 600),
    tryAgain: cleanString(obj.tryAgain, 220),
    nextTaskType: [
      'statement','yes_no_question','wh_question','negative',
      'emotion','short_answer','own_sentence','targeted_drill'
    ].includes(String(obj.nextTaskType || ''))
      ? String(obj.nextTaskType)
      : 'statement'
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
    level = 'unknown',
    journey = {}
  } = req.body || {};

  const audio = String(audioBase64 || '').trim();
  const reference = cleanString(referenceText || targetText, 240);
  const language = cleanString(uiLanguage, 80);
  const studentLevel = cleanString(level, 20);
  const journeyTurn = Math.max(0, Math.min(50, Number(journey?.turn || 0)));
  const lastFocusWord = cleanString(journey?.lastFocusWord, 80).toLowerCase();
  const sameFocusCount = Math.max(0, Math.min(5, Number(journey?.sameFocusCount || 0)));
  const previousTaskType = cleanString(journey?.taskType, 40) || 'statement';

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

SESSION CONTEXT:
- Journey turn: ${journeyTurn}
- Previous task type: ${previousTaskType}
- Previous focus word: ${lastFocusWord || '(none)'}
- Same focus repeated: ${sameFocusCount} time(s)

CORE RULE:
Analyze WHAT THE LEARNER ACTUALLY SAID IN THE AUDIO.
The reference text is optional guidance only. If they say something different, assess what they actually said.

COACHING PHILOSOPHY:
Do not trap the learner on one tiny issue.
Prioritize intelligibility and forward progress over perfection.
A minor final consonant or small accent feature should not block progress if the sentence is clearly understandable.

SCORING -> NEXT STEP RULES:
- If clarity, rhythm and stress are ALL 5/5:
  Congratulate briefly and move on. Do NOT ask them to repeat the same sentence.
  Give a new short challenge using a DIFFERENT sentence type.
- If the overall result is mostly 4/5 or better:
  Mention at most one tiny improvement, then move on to a new sentence.
- If the weakest score is 3/5:
  Give ONE targeted short drill for the clearest real issue, then the next turn should move on.
- If the weakest score is 1-2/5:
  Give one easier short drill focused on the clearest issue.
- Never require more than TWO turns on the same focus word.
  If the same focus word has already repeated twice, say it is understandable enough for now and move on.

TASK VARIETY:
Rotate simple speaking tasks so the learner does not get stuck:
statement -> yes/no question -> WH-question -> negative sentence -> emotion/exclamation -> short answer -> learner's own sentence -> repeat cycle.
Choose the next task naturally and keep it short.

"tryAgain" FIELD:
This is actually the SINGLE NEXT STEP shown to the learner.
It may be either:
1) one short targeted drill, OR
2) one new challenge sentence/instruction when they are ready to move on.
Keep it concise.

Examples of good progression:
- Mastered statement -> "Now ask: Do you have any plans for the weekend?"
- Mastered yes/no question -> "Now ask: What are you doing this weekend?"
- Strong performance -> "Your turn: Say one sentence about your weekend."
- Minor issue with 'plans' but understandable -> "Good enough — now say: What are your plans for Saturday?"
- Clear issue with one word -> short drill containing that word once.

FOCUS WORD RULES:
- At most 1-2 focus words.
- Focus words must come from words actually heard in the audio.
- Do not keep the same focus word if it has already been repeated twice in the session.
- Do not invent issues just to produce feedback.

IMPORTANT LIMITS:
- Do not claim laboratory-grade phonetic precision.
- Do not infer ethnicity, nationality, identity, health, disability, or personality from the voice.
- Do not score accent quality or tell the learner to erase their accent.
- Focus on intelligibility, clarity, word stress, sentence stress, rhythm and pacing.
- Keep feedback brief, encouraging and actionable.
- Use the requested FEEDBACK LANGUAGE for notes, but keep English practice text in English.
- Scores are coarse 1-5 coaching ratings, not percentages.

Choose "nextTaskType" from:
"statement", "yes_no_question", "wh_question", "negative", "emotion", "short_answer", "own_sentence", "targeted_drill"

Return ONLY valid JSON:
{
  "clarity": 1,
  "rhythm": 1,
  "stress": 1,
  "heard": "brief transcript of what you actually heard",
  "focusWords": [
    {"word": "word actually heard", "note": "very short actionable note"}
  ],
  "coachNote": "1-3 concise sentences in the feedback language",
  "tryAgain": "one concise next step for the learner",
  "nextTaskType": "statement"
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
      result: normalizeResult(parsed, sameFocusCount, lastFocusWord)
    });
  } catch (err) {
    console.error('Pronunciation service error:', err);
    return res.status(500).json({ error: 'Failed to analyze pronunciation.' });
  }
}
