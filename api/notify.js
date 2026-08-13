import nodemailer from 'nodemailer';

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
    GMAIL_USER,
    GMAIL_APP_PASSWORD
  } = process.env;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return res.status(500).json({
      error: 'Server is missing GMAIL_USER or GMAIL_APP_PASSWORD.'
    });
  }

  const body = req.body || {};

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD
    }
  });

  try {
    // ==========================================
    // 1. LEARNING PROFILE / MY PROGRESS
    // ==========================================
    if (body.type === 'learning_profile_link') {
      const {
        email,
        level,
        nextGoal,
        commonMistakes,
        wordsPhrases,
        strengths
      } = body;

      if (!email) {
        return res.status(400).json({
          error: 'No email provided.'
        });
      }

      await transporter.sendMail({
        from: GMAIL_USER,
        to: 'farzadghorbanpoor6@gmail.com',

        subject: `Apex Assistant — Yeni Öğrenci Profili: ${email}`,

        text:
          `Apex Assistant üzerinden yeni bir öğrenci ilerleme profilini kaydetti.\n\n` +

          `E-posta: ${email}\n` +
          `Seviye: ${level || 'unknown'}\n` +
          `Sonraki hedef: ${nextGoal || '(henüz belirlenmedi)'}\n\n` +

          `Sık yapılan hatalar:\n` +
          `${Array.isArray(commonMistakes) && commonMistakes.length
            ? commonMistakes.map(x => `- ${x}`).join('\n')
            : '- Henüz kayıt yok'}\n\n` +

          `Öğrenilen kelime / kalıplar:\n` +
          `${Array.isArray(wordsPhrases) && wordsPhrases.length
            ? wordsPhrases.map(x => `- ${x}`).join('\n')
            : '- Henüz kayıt yok'}\n\n` +

          `Güçlü yönler:\n` +
          `${Array.isArray(strengths) && strengths.length
            ? strengths.map(x => `- ${x}`).join('\n')
            : '- Henüz kayıt yok'}\n`
      });

      return res.status(200).json({
        ok: true,
        type: 'learning_profile_link'
      });
    }

    // ==========================================
    // 2. EXISTING PRICING LEAD FLOW
    // ==========================================
    const {
      visitorEmail,
      context,
      lang
    } = body;

    if (!visitorEmail) {
      return res.status(400).json({
        error: 'No visitor email provided.'
      });
    }

    await transporter.sendMail({
      from: GMAIL_USER,
      to: 'farzadghorbanpoor6@gmail.com',

      subject: `Apex English — Fiyat Talebi: ${visitorEmail}`,

      text:
        `Bir ziyaretçi chatbot üzerinden fiyat bilgisi istedi.\n\n` +
        `E-posta: ${visitorEmail}\n` +
        `Arayüz dili: ${lang || 'unknown'}\n` +
        `Mesaj: ${context || '(mesaj yok)'}\n\n` +
        `Fiyat listesini göndermek için ziyaretçiyle iletişime geçebilirsiniz.`
    });

    return res.status(200).json({
      ok: true,
      type: 'pricing_lead'
    });

  } catch (err) {
    console.error('Notify email error:', err);

    return res.status(500).json({
      error: 'Failed to send email.'
    });
  }
}
