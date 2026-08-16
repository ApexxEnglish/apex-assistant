import nodemailer from 'nodemailer';
import { applyCors, cleanText, enforceRateLimit, isValidEmail } from '../lib/security.js';

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

  const body = req.body || {};

  // Saving / restoring a learning profile is NOT a sales-lead event.
  // The browser currently sends this event for backward compatibility, but
  // the server deliberately does not forward the learner's email, mistakes,
  // goals, words or strengths to an owner/sales inbox. This keeps the UI
  // statement "email is used to verify and link learning progress" truthful.
  if (body.type === 'learning_profile_link') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }

    return res.status(200).json({
      ok: true,
      type: 'learning_profile_link',
      notified: false
    });
  }

  // Only an explicit commercial-intent email captured by the assistant uses
  // the owner notification flow below.
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

  const visitorEmail = String(body.visitorEmail || '').trim().toLowerCase();
  if (!isValidEmail(visitorEmail)) {
    return res.status(400).json({ error: 'Valid visitor email is required.' });
  }

  const context = cleanText(body.context, 1200) || '(mesaj yok)';
  const lang = cleanText(body.lang, 20) || 'unknown';

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD
    }
  });

  try {
    await transporter.sendMail({
      from: GMAIL_USER,
      to: notifyTo,
      subject: `Apex English — Fiyat Talebi: ${visitorEmail}`,
      text:
        `Bir ziyaretçi chatbot üzerinden fiyat / eğitim bilgisi için e-posta bıraktı.\n\n` +
        `E-posta: ${visitorEmail}\n` +
        `Arayüz dili: ${lang}\n` +
        `Mesaj: ${context}\n\n` +
        `Ziyaretçiyle talebi doğrultusunda iletişime geçebilirsiniz.`
    });

    return res.status(200).json({ ok: true, type: 'commercial_lead' });
  } catch (err) {
    console.error('Notify email error:', err);
    return res.status(500).json({ error: 'Failed to send email.' });
  }
}
