# 🤖 AI ChatBot

A **free, user-friendly AI chatbot website** you can host on **GitHub Pages** at zero cost.

It's a pure static site (HTML + CSS + JavaScript — no backend, no build step). Each person
who uses it brings their **own free API key**, which is stored **only in their browser** and
is never committed to the repo or sent anywhere except the AI provider they chose.

![status](https://img.shields.io/badge/cost-%24000%20free-brightgreen) ![hosting](https://img.shields.io/badge/host-GitHub%20Pages-blue)

---

## ✨ Features

- 💬 Clean, modern chat UI (message bubbles, avatars, typing indicator)
- ⚡ **Streaming replies** — text appears live, word by word, as the AI types
- ⏹ **Stop** a running reply, and **↻ Regenerate** the last answer
- 🎤 **Voice input** — dictate your message with the mic button (Web Speech API)
- 🛡️ **Request timeout + friendly errors** — never hangs; tells you *why* if something fails
- 🌙 Dark / light theme toggle
- 🧠 Conversation **memory** within a chat + multiple saved conversations
- 📝 Markdown rendering with **syntax-highlighted code blocks** and a copy button
- 📱 Fully responsive (works great on mobile)
- 🔌 Works with multiple **free** AI providers:
  - **Google Gemini** (recommended — generous free tier, no card needed)
  - **Groq** (very fast, free tier)
  - **OpenRouter** (has `:free` models)
  - Any **OpenAI-compatible** endpoint (custom)
- 🔐 Your API key stays in **your browser** (`localStorage`) — nothing server-side

---

## 🚀 Quick start (run locally)

Because it's a static site, just open it — but to let the browser talk to the APIs, serve it
over `http://` rather than `file://`:

```bash
# Python (any version 3.x)
python3 -m http.server 8000
# then open http://localhost:8000
```

Or use any static server (`npx serve`, VS Code "Live Server", etc.).

---

## 🌐 Host it free on GitHub Pages

1. Push this repository to GitHub (see below if you haven't).
2. On GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick your branch (e.g. `main`) and folder **`/ (root)`**, then **Save**.
5. Wait ~1 minute. Your chatbot will be live at:
   `https://<your-username>.github.io/<repo-name>/`

> This repo also includes `.github/workflows/deploy.yml`, which auto-deploys to GitHub Pages
> on every push to `main`. If you use that, set **Source** to **GitHub Actions** instead (step 3).

---

## 🔑 Getting a free API key

Open the site, click **⚙️ Settings**, pick a provider, and paste a key:

| Provider | Free key page | Notes |
|---|---|---|
| **Google Gemini** | https://aistudio.google.com/app/apikey | Easiest; no credit card. Default model: `gemini-flash-latest` |
| **Groq** | https://console.groq.com/keys | Extremely fast. Model e.g. `llama-3.3-70b-versatile` |
| **OpenRouter** | https://openrouter.ai/keys | Use a model ending in `:free` |

Paste the key → **Save** → start chatting. 🎉

---

## 🔒 A note on security

This is a **client-side** app, so the API call happens from the user's browser using **their own**
key. That's exactly why it can be hosted free on GitHub Pages. **Never hard-code your own API key
into the source** and commit it — it would be public. The app intentionally asks each user for
their own key instead.

If you later want to hide a shared key behind a server (so visitors don't need their own), you'd
add a small backend/serverless proxy — but that's no longer free static hosting. The current
bring-your-own-key design keeps it 100% free.

---

## 🗂️ Project structure

```
AI_ChatBot/
├── index.html   # markup + layout
├── style.css    # theme + responsive styling
├── app.js       # chat logic, providers, storage
├── .github/workflows/deploy.yml   # optional auto-deploy to GitHub Pages
└── README.md
```

## 🛠️ Customize

- **Personality:** Settings → *System prompt* (e.g. "You are a pirate who loves math").
- **Default provider/model:** edit the `PROVIDERS` object at the top of `app.js`.
- **Colors / theme:** edit the CSS variables under `:root` in `style.css`.

---

Built as a free starter. Fork it, change it, make it yours. 💙
