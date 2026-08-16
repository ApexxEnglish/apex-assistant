import nodemailer from 'nodemailer';
import { applyCors, cleanText, enforceRateLimit, isValidEmail } from '../lib/security.js';

function cleanList(value, maxItems = 5) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map(item => cleanText(item, 220)).filter(Boolean)
    : [];
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

  if (!enforceRateLimit(req, res, {
    scope: 'notify-minute',
    max: 8,
    windowMs: 60_000,
    message: 'Too many notification requests.'
  })) return;

  if (!enforceRateLimit(req, res, {
    scope: 'notify-day',
    max: 60,
    windowMs: 24 * 60 * 60 * 1000,
    message: 'Daily notification limit reached.'
  })) return;

  const {
    GMAIL_USER,
    GMAIL_APP_PASSWORD,
    NOTIFY_TO_EMAIL
  } = process.env;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return res.status(500).json({
      error: 'Server is missing GMAIL_USER or GMAIL_APP_PASSWORD.'
    });
  }

  const notifyTo = String(NOTIFY_TO_EMAIL || GMAIL_USER).trim();
  if (!isValidEmail(notifyTo)) {
    return res.status(500).json({ error: 'Notification recipient is not configured correctly.' });
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
    if (body.type === 'learning_profile_link') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Valid email is required.' });
      }

      const level = ['A1', 'A2', 'B1', 'B2', 'C1'].includes(String(body.level || ''))
        ? String(body.level)
        : 'unknown';
      const nextGoal = cleanText(body.nextGoal, 300) || '(henüz belirlenmedi)';
      const commonMistakes = cleanList(body.commonMistakes, 5);
      const wordsPhrases = cleanList(body.wordsPhrases, 8);
      const strengths = cleanList(body.strengths, 5);

      await transporter.sendMail({
        from: GMAIL_USER,
        to: notifyTo,
        subject: `Apex Assistant — Yeni Öğrenci Profili: ${email}`,
        text:
          `Apex Assistant üzerinden yeni bir öğrenci ilerleme profilini kaydetti.\n\n` +
          `E-posta: ${email}\n` +
          `Seviye: ${level}\n` +
          `Sonraki hedef: ${nextGoal}\n\n` +
          `Sık yapılan hatalar:\n${commonMistakes.length ? commonMistakes.map(x => `- ${x}`).join('\n') : '- Henüz kayıt yok'}\n\n` +
          `Öğrenilen kelime / kalıplar:\n${wordsPhrases.length ? wordsPhrases.map(x => `- ${x}`).join('\n') : '- Henüz kayıt yok'}\n\n` +
          `Güçlü yönler:\n${strengths.length ? strengths.map(x => `- ${x}`).join('\n') : '- Henüz kayıt yok'}\n`
      });

      return res.status(200).json({ ok: true, type: 'learning_profile_link' });
    }

    const visitorEmail = String(body.visitorEmail || '').trim().toLowerCase();
    if (!isValidEmail(visitorEmail)) {
      return res.status(400).json({ error: 'Valid visitor email is required.' });
    }

    const context = cleanText(body.context, 1200) || '(mesaj yok)';
    const lang = cleanText(body.lang, 20) || 'unknown';

    await transporter.sendMail({
      from: GMAIL_USER,
      to: notifyTo,
      subject: `Apex English — Fiyat Talebi: ${visitorEmail}`,
      text:
        `Bir ziyaretçi chatbot üzerinden fiyat bilgisi istedi.\n\n` +
        `E-posta: ${visitorEmail}\n` +
        `Arayüz dili: ${lang}\n` +
        `Mesaj: ${context}\n\n` +
        `Fiyat listesini göndermek için ziyaretçiyle iletişime geçebilirsiniz.`
    });

    return res.status(200).json({ ok: true, type: 'pricing_lead' });
  } catch (err) {
    console.error('Notify email error:', err);
    return res.status(500).json({ error: 'Failed to send email.' });
  }
}
