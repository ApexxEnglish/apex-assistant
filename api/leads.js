import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { applyCors, cleanText, enforceRateLimit, isValidEmail } from '../lib/security.js';

const PROGRAMS = new Set([
  'Genel İngilizce', 'Konuşma İngilizcesi', 'İş İngilizcesi',
  'Yönetici İngilizcesi', 'Kurumsal İngilizce', 'Mülakat Hazırlığı',
  'IELTS / TOEFL / YDS', 'Kids & Teens', 'Diğer'
]);
const LEVELS = new Set(['Bilmiyorum', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const FORMATS = new Set(['Fark etmez', 'Online', 'Yüz yüze']);

export default async function handler(req, res) {
  if (!applyCors(req, res)) return res.status(403).json({ error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const raw = req.body || {};
  if (JSON.stringify(raw).length > 8_000) return res.status(413).json({ error: 'Form is too large.' });
  // Honeypot: pretend to accept automated submissions but do not save them.
  if (raw.website) return res.status(200).json({ ok: true, notified: false });

  const name = cleanText(raw.fullName, 90);
  const phone = cleanText(raw.phone, 24);
  const email = String(raw.email || '').trim().toLowerCase();
  const program = cleanText(raw.program, 90);
  const level = cleanText(raw.level, 20) || 'Bilmiyorum';
  const format = cleanText(raw.format, 30) || 'Fark etmez';
  const availability = cleanText(raw.availability, 100);
  const goal = cleanText(raw.goal, 500);
  const lang = cleanText(raw.lang, 10);
  const phoneDigits = phone.replace(/\D/g, '');

  if (!name || name.length < 2 || !PROGRAMS.has(program) || !LEVELS.has(level) || !FORMATS.has(format)) {
    return res.status(400).json({ error: 'Ad, program veya seçimler geçersiz.' });
  }
  if ((!phone && !email) || (email && !isValidEmail(email)) || (phone && (phoneDigits.length < 9 || phoneDigits.length > 15))) {
    return res.status(400).json({ error: 'Geçerli telefon veya e-posta gerekli.' });
  }
  if (raw.noticeRead !== true || raw.contactApproved !== true) {
    return res.status(400).json({ error: 'Gerekli aydınlatma ve iletişim onayı eksik.' });
  }

  // Only valid, consented submissions consume the submission quota.
  if (!enforceRateLimit(req, res, { scope: 'apex-lead-minute-v2', max: 10, windowMs: 60_000 })) return;
  if (!enforceRateLimit(req, res, { scope: 'apex-lead-day-v2', max: 60, windowMs: 86_400_000 })) return;

  const hook = process.env.GOOGLE_LEADS_WEBHOOK_URL;
  const secret = process.env.GOOGLE_LEADS_WEBHOOK_SECRET;
  if (!hook || !secret || secret.length < 24 || !/^https:\/\/script\.google\.com\/macros\/s\//.test(hook)) {
    return res.status(503).json({ error: 'Öğrenci kayıt bağlantısı henüz yapılandırılmadı.' });
  }

  const lead = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    fullName: name, phone, email, program, level, format,
    availability, goal, lang, source: 'apex_assistant_advisor',
    noticeRead: true, contactApproved: true, status: 'Yeni talep'
  };

  try {
    // The Google Sheets write is the source of truth. Don't claim success unless it succeeds.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let result;
    try {
      const response = await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret, lead }),
        signal: controller.signal,
        redirect: 'follow'
      });
      result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true || result.id !== lead.id) {
        console.error('Google Sheets webhook rejected the lead:', {
          status: response.status,
          message: String(result.error || 'Invalid confirmation').slice(0, 160)
        });
        throw new Error('Google Sheets did not confirm the save.');
      }
    } finally { clearTimeout(timeout); }

    let notified = false;
    const gmailUser = process.env.GMAIL_USER;
    const gmailPassword = process.env.GMAIL_APP_PASSWORD;
    const notifyTo = String(process.env.NOTIFY_TO_EMAIL || gmailUser || '').trim();
    if (gmailUser && gmailPassword && isValidEmail(notifyTo)) {
      try {
        const mailer = nodemailer.createTransport({
          service: 'gmail', auth: { user: gmailUser, pass: gmailPassword }
        });
        await mailer.sendMail({
          from: gmailUser,
          to: notifyTo,
          subject: `Apex English — Yeni Demo Talebi: ${name}`,
          text: [
            'Apex English AI Eğitim Danışmanı üzerinden yeni demo talebi:', '',
            `Ad soyad: ${name}`, `Telefon: ${phone || '—'}`, `E-posta: ${email || '—'}`,
            `Program: ${program}`, `Seviye (beyan): ${level}`, `Ders tercihi: ${format}`,
            `Uygun zaman: ${availability || '—'}`, `Hedef: ${goal || '—'}`,
            `Kayıt ID: ${lead.id}`, `Tarih: ${lead.createdAt}`, '',
            'Google Sheets kayıtlarına işlendi. Demo saati ekip tarafından onaylanmalıdır.'
          ].join('\n')
        });
        notified = true;
      } catch (error) {
        console.error('Lead saved but owner email failed:', error.message);
      }
    }
    return res.status(200).json({ ok: true, id: lead.id, notified });
  } catch (error) {
    console.error('Lead storage error:', error.message);
    return res.status(502).json({ error: 'Talep kaydedilemedi. Lütfen tekrar deneyin.' });
  }
}
