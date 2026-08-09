// Vercel serverless function — holds the Gemini API key server-side.
// Never move this key into index.html or any client-side code.
//
// Set GEMINI_API_KEY in your Vercel project's Environment Variables
// (get a free key at https://aistudio.google.com/apikey).

export default async function handler(req, res) {
  // Allow the widget to be embedded on a different domain than this
  // function is deployed on. Once your site is live, you can tighten
  // this to your real domain instead of '*'.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY. Add it in Vercel project settings.' });
    return;
  }

  const { systemPrompt, messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'No messages provided.' });
    return;
  }

  // Gemini uses "model" instead of "assistant" for its own turns.
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  try {
    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt || '' }] },
          contents
        })
      }
    );

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      res.status(geminiResponse.status).json({ error: data.error?.message || 'Gemini API error.' });
      return;
    }

    const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reach Gemini API.' });
  }
}
