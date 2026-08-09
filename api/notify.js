// Vercel serverless function — sends you an email whenever the chat widget
// collects a visitor's email during a pricing conversation, so you can
// follow up with them directly (e.g. send the full pricing table).
//
// Requires these Environment Variables in your Vercel project:
//   GMAIL_USER          - the Gmail address that will SEND the notification
//   GMAIL_APP_PASSWORD   - a 16-character Gmail "App Password" (not your normal password)
//   NOTIFY_TO_EMAIL      - (optional) where the notification goes. Defaults to GMAIL_USER.
//
// See README.md for how to create a Gmail App Password.

import nodemailer from 'nodemailer';

export default async function handler(req, res) {
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

  const { GMAIL_USER, GMAIL_APP_PASSWORD, NOTIFY_TO_EMAIL } = process.env;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    res.status(500).json({ error: 'Server is missing GMAIL_USER or GMAIL_APP_PASSWORD.' });
    return;
  }

  const { visitorEmail, context, lang } = req.body || {};

  if (!visitorEmail) {
    res.status(400).json({ error: 'No visitor email provided.' });
    return;
  }

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
      to: NOTIFY_TO_EMAIL || GMAIL_USER,
      subject: `Send pricing table to ${visitorEmail}`,
      text:
        `A visitor asked about pricing in your website chat and left their email.\n\n` +
        `Their email: ${visitorEmail}\n` +
        `Interface language: ${lang || 'unknown'}\n` +
        `Their message: ${context || '(no message)'}\n\n` +
        `Reply directly to them with the pricing table.`
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send email.' });
  }
}
