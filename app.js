/* =========================================================================
   AI ChatBot — front-end logic
   A static, GitHub-Pages-hostable chatbot. Each user brings their OWN free
   API key, which is stored only in their browser's localStorage.

   Supports: Google Gemini (native) + any OpenAI-compatible API (Groq,
   OpenRouter, custom).

   Features: streaming replies, stop/regenerate, request timeout with
   friendly errors, and voice input (Web Speech API).
   ========================================================================= */

(() => {
  "use strict";

  // ---- Provider presets -------------------------------------------------
  const PROVIDERS = {
    gemini: {
      label: "Google Gemini",
      kind: "gemini",
      defaultModel: "gemini-flash-latest",
      keyHint:
        'Get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a> — no credit card needed.',
    },
    groq: {
      label: "Groq",
      kind: "openai",
      baseUrl: "https://api.groq.com/openai/v1",
      defaultModel: "llama-3.3-70b-versatile",
      keyHint:
        'Get a free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> — very fast, free tier.',
    },
    openrouter: {
      label: "OpenRouter",
      kind: "openai",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
      keyHint:
        'Get a free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. Use a model ending in <code>:free</code>. Best choice for browser-only sites.',
    },
    custom: {
      label: "Custom",
      kind: "openai",
      baseUrl: "",
      defaultModel: "",
      keyHint: "Any OpenAI-compatible endpoint. Enter the base URL and model below.",
    },
  };

  const DEFAULT_SYSTEM = "You are a helpful, friendly, and concise AI assistant.";
  const TIMEOUT_MS = 45000; // abort if no activity for this long

  // ---- State ------------------------------------------------------------
  const LS = {
    settings: "aichatbot.settings",
    chats: "aichatbot.chats",
    theme: "aichatbot.theme",
  };

  let settings = loadJSON(LS.settings, {
    provider: "gemini",
    apiKey: "",
    model: "",
    baseUrl: "",
    systemPrompt: DEFAULT_SYSTEM,
  });

  let chats = loadJSON(LS.chats, []); // [{id, title, messages:[{role, content}]}]
  let currentId = chats.length ? chats[0].id : null;
  let busy = false;
  let currentAbort = null; // AbortController for the in-flight request
  let stopRequested = false;
  let timedOut = false;

  // ---- Element refs -----------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    messages: $("messages"),
    welcome: $("welcome"),
    input: $("input"),
    composer: $("composer"),
    sendBtn: $("sendBtn"),
    micBtn: $("micBtn"),
    actionBar: $("actionBar"),
    regenBtn: $("regenBtn"),
    historyList: $("historyList"),
    headerTitle: $("headerTitle"),
    statusPill: $("statusPill"),
    newChatBtn: $("newChatBtn"),
    sidebar: $("sidebar"),
    openSidebar: $("openSidebar"),
    closeSidebar: $("closeSidebar"),
    openSettings: $("openSettings"),
    closeSettings: $("closeSettings"),
    settingsBackdrop: $("settingsBackdrop"),
    saveSettings: $("saveSettings"),
    clearData: $("clearData"),
    themeToggle: $("themeToggle"),
    provider: $("provider"),
    apiKey: $("apiKey"),
    model: $("model"),
    baseUrl: $("baseUrl"),
    baseUrlRow: $("baseUrlRow"),
    systemPrompt: $("systemPrompt"),
    keyHint: $("keyHint"),
    toggleKey: $("toggleKey"),
    toast: $("toast"),
  };

  // ---- Helpers ----------------------------------------------------------
  function loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      /* storage may be blocked (private mode) — app still works in-memory */
    }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), 3200);
  }

  function currentChat() {
    return chats.find((c) => c.id === currentId) || null;
  }

  function activeModel() {
    const p = PROVIDERS[settings.provider] || PROVIDERS.gemini;
    return settings.model || p.defaultModel;
  }

  // ---- Rendering --------------------------------------------------------
  function renderStatus() {
    const p = PROVIDERS[settings.provider];
    if (!settings.apiKey) {
      el.statusPill.textContent = "Not configured";
      el.statusPill.style.color = "var(--danger)";
    } else {
      el.statusPill.textContent = `${p ? p.label : "AI"} · ${activeModel()}`;
      el.statusPill.style.color = "";
    }
  }

  function renderHistory() {
    el.historyList.innerHTML = "";
    chats.forEach((c) => {
      const item = document.createElement("div");
      item.className = "history-item" + (c.id === currentId ? " active" : "");
      item.innerHTML = `<span class="label">💬 ${escapeHtml(c.title)}</span>
        <button class="del" title="Delete" aria-label="Delete chat">🗑️</button>`;
      item.querySelector(".label").onclick = () => selectChat(c.id);
      item.querySelector(".del").onclick = (e) => {
        e.stopPropagation();
        deleteChat(c.id);
      };
      el.historyList.appendChild(item);
    });
  }

  function renderMessages() {
    const chat = currentChat();
    el.messages.innerHTML = "";
    if (!chat || chat.messages.length === 0) {
      el.messages.appendChild(el.welcome);
      el.welcome.style.display = "";
      el.headerTitle.textContent = chat ? chat.title : "New chat";
      updateActionBar();
      return;
    }
    el.welcome.style.display = "none";
    chat.messages.forEach((m) => el.messages.appendChild(messageEl(m.role, m.content)));
    el.headerTitle.textContent = chat.title;
    updateActionBar();
    scrollToBottom();
  }

  function messageEl(role, content) {
    const row = document.createElement("div");
    row.className = `msg-row ${role === "user" ? "user" : "bot"}`;
    const avatar = document.createElement("div");
    avatar.className = `avatar ${role === "user" ? "user" : "bot"}`;
    avatar.textContent = role === "user" ? "🧑" : "🤖";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (role === "user") {
      bubble.textContent = content;
    } else {
      bubble.innerHTML = renderMarkdown(content);
      enhanceCodeBlocks(bubble);
    }
    row.appendChild(avatar);
    row.appendChild(bubble);
    return row;
  }

  function renderMarkdown(text) {
    if (window.marked) {
      try {
        return window.marked.parse(text, { breaks: true, gfm: true });
      } catch {
        /* fall through */
      }
    }
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function enhanceCodeBlocks(container) {
    container.querySelectorAll("pre code").forEach((code) => {
      if (window.hljs) {
        try {
          window.hljs.highlightElement(code);
        } catch {}
      }
      const pre = code.parentElement;
      if (pre.querySelector(".code-head")) return;
      const head = document.createElement("div");
      head.className = "code-head";
      const lang = (code.className.match(/language-(\w+)/) || [, "code"])[1];
      head.innerHTML = `<span>${lang}</span><button class="copy-btn">Copy</button>`;
      head.querySelector(".copy-btn").onclick = () => {
        navigator.clipboard.writeText(code.textContent).then(() => toast("Copied!"));
      };
      pre.insertBefore(head, code);
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function updateActionBar() {
    const chat = currentChat();
    const lastIsBot =
      chat && chat.messages.length && chat.messages[chat.messages.length - 1].role === "assistant";
    el.actionBar.hidden = !(lastIsBot && !busy);
  }

  // ---- Chat management --------------------------------------------------
  function newChat() {
    const chat = { id: uid(), title: "New chat", messages: [] };
    chats.unshift(chat);
    currentId = chat.id;
    persist();
    renderHistory();
    renderMessages();
    renderStatus();
    closeSidebarMobile();
    el.input.focus();
  }

  function selectChat(id) {
    currentId = id;
    renderHistory();
    renderMessages();
    closeSidebarMobile();
  }

  function deleteChat(id) {
    chats = chats.filter((c) => c.id !== id);
    if (currentId === id) currentId = chats.length ? chats[0].id : null;
    persist();
    renderHistory();
    renderMessages();
  }

  function persist() {
    saveJSON(LS.chats, chats);
  }

  // ---- Sending / generating ---------------------------------------------
  async function sendMessage(text) {
    text = text.trim();
    if (!text || busy) return;

    if (!settings.apiKey) {
      openSettings();
      toast("Add your free API key first 🔑");
      return;
    }

    let chat = currentChat();
    if (!chat) {
      newChat();
      chat = currentChat();
    }

    chat.messages.push({ role: "user", content: text });
    if (chat.title === "New chat") {
      chat.title = text.slice(0, 40) + (text.length > 40 ? "…" : "");
    }
    el.welcome.style.display = "none";
    el.messages.appendChild(messageEl("user", text));
    el.headerTitle.textContent = chat.title;
    renderHistory();
    scrollToBottom();
    persist();

    await generateReply(chat);
  }

  // Re-generate the reply to the most recent user message.
  function regenerate() {
    const chat = currentChat();
    if (!chat || busy) return;
    while (chat.messages.length && chat.messages[chat.messages.length - 1].role === "assistant") {
      chat.messages.pop();
    }
    if (!chat.messages.some((m) => m.role === "user")) return;
    persist();
    renderMessages();
    generateReply(chat);
  }

  // Core generation routine: streams the reply into a fresh bot bubble.
  async function generateReply(chat) {
    setBusy(true);
    stopRequested = false;
    timedOut = false;

    // Create the bot bubble up front; we stream text into it.
    const row = document.createElement("div");
    row.className = "msg-row bot";
    row.innerHTML = `<div class="avatar bot">🤖</div><div class="bubble"></div>`;
    const bubble = row.querySelector(".bubble");
    bubble.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
    el.messages.appendChild(row);
    scrollToBottom();

    currentAbort = new AbortController();
    let acc = "";
    let gotFirst = false;
    let lastPaint = 0;

    const paint = (force) => {
      const now = Date.now();
      if (!force && now - lastPaint < 60) return;
      lastPaint = now;
      bubble.innerHTML = renderMarkdown(acc) + '<span class="stream-cursor"></span>';
      scrollToBottom();
    };

    let timer = setTimeout(() => {
      timedOut = true;
      if (currentAbort) currentAbort.abort();
    }, TIMEOUT_MS);
    const kick = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        if (currentAbort) currentAbort.abort();
      }, TIMEOUT_MS);
    };

    const onDelta = (chunk) => {
      if (!chunk) return;
      if (!gotFirst) {
        gotFirst = true;
        bubble.innerHTML = "";
      }
      acc += chunk;
      kick();
      paint(false);
    };

    try {
      await callAPIStream(chat.messages, onDelta, currentAbort.signal);
      clearTimeout(timer);
      finalizeBubble(bubble, acc || "_(empty response)_");
      chat.messages.push({ role: "assistant", content: acc });
      persist();
    } catch (err) {
      clearTimeout(timer);
      if (stopRequested && acc) {
        // User stopped — keep whatever streamed so far.
        finalizeBubble(bubble, acc + "\n\n_⏹ Stopped._");
        chat.messages.push({ role: "assistant", content: acc + "\n\n_⏹ Stopped._" });
      } else if (timedOut) {
        const msg =
          (acc ? acc + "\n\n" : "") +
          "⚠️ **Request timed out.** The provider didn't respond in time. Check your model name/key, or try again.";
        finalizeBubble(bubble, msg);
        chat.messages.push({ role: "assistant", content: msg });
      } else {
        const msg = "⚠️ " + friendlyError(err);
        finalizeBubble(bubble, msg);
        chat.messages.push({ role: "assistant", content: msg });
      }
      persist();
    } finally {
      currentAbort = null;
      setBusy(false);
    }
  }

  function finalizeBubble(bubble, text) {
    bubble.innerHTML = renderMarkdown(text);
    enhanceCodeBlocks(bubble);
    scrollToBottom();
  }

  function stopGeneration() {
    if (!busy || !currentAbort) return;
    stopRequested = true;
    currentAbort.abort();
  }

  function friendlyError(err) {
    const m = (err && err.message) || String(err);
    if (/Failed to fetch|NetworkError|Load failed|ERR_/i.test(m)) {
      return (
        "**Couldn't reach the AI provider.** The request was blocked before it got a response. Usually one of:\n\n" +
        "- A **browser extension / ad-blocker** — try an **Incognito** window.\n" +
        "- A **CORS** block — try switching **Provider → OpenRouter** in Settings (best for browser-only sites).\n" +
        "- Your **network / firewall** blocking the API.\n\n" +
        "Tip: press **F12 → Console** to see the exact reason."
      );
    }
    return "**Error:** " + m;
  }

  function setBusy(v) {
    busy = v;
    if (v) {
      el.sendBtn.classList.add("stop");
      el.sendBtn.textContent = "■";
      el.sendBtn.title = "Stop";
    } else {
      el.sendBtn.classList.remove("stop");
      el.sendBtn.textContent = "➤";
      el.sendBtn.title = "Send";
    }
    updateActionBar();
  }

  // ---- API calls (streaming) --------------------------------------------
  async function callAPIStream(messages, onDelta, signal) {
    const provider = PROVIDERS[settings.provider] || PROVIDERS.gemini;
    const model = activeModel();
    const system = settings.systemPrompt || DEFAULT_SYSTEM;

    if (provider.kind === "gemini") {
      return streamGemini(model, system, messages, onDelta, signal);
    }
    const baseUrl = settings.baseUrl || provider.baseUrl;
    if (!baseUrl) throw new Error("No base URL configured for this provider.");
    return streamOpenAI(baseUrl, model, system, messages, onDelta, signal);
  }

  // Parse an SSE stream line-by-line, calling extract() on each data payload.
  async function readSSE(res, extract, onDelta) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line || !line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          onDelta(extract(JSON.parse(data)));
        } catch {
          /* ignore malformed/partial JSON lines */
        }
      }
    }
  }

  async function errorFromResponse(res, label) {
    let data = {};
    try {
      data = await res.json();
    } catch {}
    const detail = data?.error?.message || data?.message || `HTTP ${res.status}`;
    return new Error(`${label}: ${detail}`);
  }

  // Google Gemini streaming (Server-Sent Events).
  async function streamGemini(model, system, messages, onDelta, signal) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:streamGenerateContent?alt=sse&key=${encodeURIComponent(settings.apiKey)}`;

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { temperature: 0.7 },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await errorFromResponse(res, "Gemini API error");

    await readSSE(
      res,
      (json) => json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "",
      onDelta
    );
  }

  // OpenAI-compatible streaming (Groq, OpenRouter, custom).
  async function streamOpenAI(baseUrl, model, system, messages, onDelta, signal) {
    const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const body = {
      model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.7,
      stream: true,
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await errorFromResponse(res, "API error");

    await readSSE(res, (json) => json?.choices?.[0]?.delta?.content || "", onDelta);
  }

  // ---- Voice input (Web Speech API) -------------------------------------
  let recognition = null;
  let listening = false;

  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      el.micBtn.hidden = true; // not supported (e.g. Firefox) — hide the button
      return;
    }
    el.micBtn.hidden = false;
    recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    let baseText = "";
    recognition.onstart = () => {
      listening = true;
      baseText = el.input.value ? el.input.value + " " : "";
      el.micBtn.classList.add("listening");
      el.micBtn.title = "Stop listening";
    };
    recognition.onresult = (e) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      el.input.value = baseText + transcript;
      autoResize();
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast("🎤 Microphone permission denied");
      }
    };
    recognition.onend = () => {
      listening = false;
      el.micBtn.classList.remove("listening");
      el.micBtn.title = "Voice input";
      el.input.focus();
    };
  }

  function toggleVoice() {
    if (!recognition) return;
    if (listening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch {
        /* start() throws if already starting — ignore */
      }
    }
  }

  // ---- Settings UI ------------------------------------------------------
  function openSettings() {
    el.provider.value = settings.provider;
    el.apiKey.value = settings.apiKey;
    el.model.value = settings.model;
    el.baseUrl.value = settings.baseUrl;
    el.systemPrompt.value = settings.systemPrompt;
    syncProviderUI();
    el.settingsBackdrop.hidden = false;
  }
  function closeSettings() {
    el.settingsBackdrop.hidden = true;
  }

  function syncProviderUI() {
    const p = PROVIDERS[el.provider.value];
    el.keyHint.innerHTML = p.keyHint;
    const isCustom = el.provider.value === "custom";
    el.baseUrl.hidden = !isCustom;
    el.baseUrlRow.hidden = !isCustom;
    if (!el.model.value) el.model.placeholder = p.defaultModel || "model name";
  }

  function saveSettings() {
    settings.provider = el.provider.value;
    settings.apiKey = el.apiKey.value.trim();
    settings.model = el.model.value.trim();
    settings.baseUrl = el.baseUrl.value.trim();
    settings.systemPrompt = el.systemPrompt.value.trim() || DEFAULT_SYSTEM;
    saveJSON(LS.settings, settings);
    renderStatus();
    closeSettings();
    toast("Settings saved ✓");
  }

  function clearAllData() {
    if (!confirm("Delete all chats and settings from this browser? This cannot be undone.")) return;
    try {
      localStorage.removeItem(LS.settings);
      localStorage.removeItem(LS.chats);
    } catch {}
    chats = [];
    currentId = null;
    settings = { provider: "gemini", apiKey: "", model: "", baseUrl: "", systemPrompt: DEFAULT_SYSTEM };
    renderHistory();
    renderMessages();
    renderStatus();
    closeSettings();
    toast("All data cleared");
  }

  // ---- Theme ------------------------------------------------------------
  function initTheme() {
    const saved = localStorage.getItem(LS.theme) || "dark";
    document.documentElement.setAttribute("data-theme", saved);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(LS.theme, next);
    } catch {}
  }

  // ---- Sidebar (mobile) -------------------------------------------------
  function openSidebarMobile() {
    el.sidebar.classList.add("open");
  }
  function closeSidebarMobile() {
    el.sidebar.classList.remove("open");
  }

  // ---- Composer behavior ------------------------------------------------
  function autoResize() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 180) + "px";
  }

  // ---- Event wiring -----------------------------------------------------
  function bind() {
    el.composer.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) {
        stopGeneration();
        return;
      }
      const text = el.input.value;
      el.input.value = "";
      autoResize();
      sendMessage(text);
    });

    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        el.composer.requestSubmit();
      }
    });
    el.input.addEventListener("input", autoResize);

    el.micBtn.addEventListener("click", toggleVoice);
    el.regenBtn.addEventListener("click", regenerate);

    el.newChatBtn.addEventListener("click", newChat);
    el.openSettings.addEventListener("click", openSettings);
    el.closeSettings.addEventListener("click", closeSettings);
    el.saveSettings.addEventListener("click", saveSettings);
    el.clearData.addEventListener("click", clearAllData);
    el.themeToggle.addEventListener("click", toggleTheme);
    el.provider.addEventListener("change", () => {
      el.model.value = "";
      syncProviderUI();
    });
    el.toggleKey.addEventListener("click", () => {
      const show = el.apiKey.type === "password";
      el.apiKey.type = show ? "text" : "password";
      el.toggleKey.textContent = show ? "Hide" : "Show";
    });

    el.openSidebar.addEventListener("click", openSidebarMobile);
    el.closeSidebar.addEventListener("click", closeSidebarMobile);

    el.settingsBackdrop.addEventListener("click", (e) => {
      if (e.target === el.settingsBackdrop) closeSettings();
    });

    document.querySelectorAll(".suggestion").forEach((btn) => {
      btn.addEventListener("click", () => {
        const map = {
          "💡 Explain a tricky topic simply": "Explain quantum computing in simple terms.",
          "✍️ Help me write an email": "Help me write a polite email asking my team for a project update.",
          "🐍 Write a Python function": "Write a Python function that checks if a number is prime, with comments.",
          "🌍 Translate a sentence": 'Translate "Good morning, have a wonderful day!" into Spanish, French, and Japanese.',
        };
        sendMessage(map[btn.textContent] || btn.textContent);
      });
    });
  }

  // ---- Init -------------------------------------------------------------
  function init() {
    initTheme();
    bind();
    initVoice();
    renderHistory();
    renderMessages();
    renderStatus();
    if (!settings.apiKey) {
      setTimeout(openSettings, 400); // first-run onboarding
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
