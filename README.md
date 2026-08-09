# English Site Bot

A chat widget for an English-teaching website. Answers course/pricing questions,
doubles as a conversation partner that gently corrects grammar, works in
Turkish/English/Russian, opens itself after 30 seconds, and emails you
whenever a visitor clicks "Pricing." Runs for free on Gemini + Vercel.

## 1. Get a free Gemini API key

1. Go to https://aistudio.google.com/apikey
2. Sign in with a Google account and click **Create API key**.
3. Copy it somewhere safe — you'll paste it into Vercel in step 4, never into the code.

## 2. Create a Gmail App Password (for pricing-click emails)

Gmail won't let apps log in with your normal password, so you need a separate
"App Password":

1. Go to https://myaccount.google.com/security
2. Turn on **2-Step Verification** if it isn't already on (required for App Passwords).
3. Go to https://myaccount.google.com/apppasswords
4. Create a new app password (name it anything, e.g. "Website bot"), and copy
   the 16-character code it gives you. This is `GMAIL_APP_PASSWORD`.
5. Decide which Gmail address sends the notification (`GMAIL_USER`) and which
   address should receive it (`NOTIFY_TO_EMAIL` — can be the same address,
   or your personal inbox).

## 3. Push this project to GitHub

```bash
cd english-bot
git init
git add .
git commit -m "Initial commit"
```

Create a new empty repository on GitHub, then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git branch -M main
git push -u origin main
```

## 4. Deploy on Vercel

1. Go to https://vercel.com and sign in (you can use your GitHub account).
2. Click **Add New… → Project** and import the repo you just pushed.
3. Vercel auto-detects the static site plus the two functions in `/api` —
   no build settings needed.
4. Before deploying, open **Environment Variables** and add all of these:

   | Key | Value |
   |---|---|
   | `GEMINI_API_KEY` | the key from step 1 |
   | `GMAIL_USER` | the Gmail address that will send notifications |
   | `GMAIL_APP_PASSWORD` | the 16-character app password from step 2 |
   | `NOTIFY_TO_EMAIL` | the address that should receive them (optional — defaults to `GMAIL_USER`) |

5. Click **Deploy**. You'll get a live URL like `https://your-project.vercel.app`.

## 5. Try it

Visit your Vercel URL:
- The widget opens on its own after 30 seconds, or click the mark icon any time.
- Switch between TR / EN / RU to test each language.
- Click **Pricing** (or "Fiyatlar" / "Цены") — you should get an email within
  a few seconds.

If you saw an error like *"Üzgünüm, asistana ulaşırken bir sorun oluştu"*
before deploying, that's expected — the widget was calling `/api/chat`,
which only exists once this project is actually deployed (or run locally
with `vercel dev`). Opening `index.html` by double-clicking it will never
work, since there's no server behind it. Once it's deployed with the env
vars above, that error should go away.

## 6. Put it on your real website

**Option A — host your whole site on Vercel.** Replace the demo content in
`index.html` with your actual site and keep the widget code as-is. Simplest
option.

**Option B — keep your site elsewhere, just call this API.** Copy the
widget's HTML/CSS/JS (the `#launcher`, `#panel`, and `<script>` block) into
your existing site's pages, and change both fetch URLs in the script from
`/api/chat` and `/api/notify` to your full Vercel URL, e.g.:

```js
fetch("https://your-project.vercel.app/api/chat", { ... })
fetch("https://your-project.vercel.app/api/notify", { ... })
```

Both functions send `Access-Control-Allow-Origin: *`, so they'll accept
requests from any domain out of the box. Once things are working, you can
tighten that in `api/chat.js` and `api/notify.js` to just your real website's
domain for a bit more safety.

## Notes

- The Gemini free tier has rate limits (requests per minute/day) — fine for
  a small teaching site. Check current limits at https://ai.google.dev/pricing
  if traffic grows.
- Course levels/pricing/schedule text lives inside `buildSystemPrompt()` in
  `index.html` — edit it there to match your real offerings.
- Neither API key nor the Gmail app password ever reaches the browser — both
  only exist in Vercel's environment variables and inside the `/api`
  functions on the server.
- Right now the email only fires when someone clicks the **Pricing** quick-reply
  button, not when they type a pricing question by hand. If you'd like it to
  also catch typed questions about price, that's a small follow-up change —
  just ask.
