/* =========================================================================
   AI ChatBot — front-end logic
   A static, GitHub-Pages-hostable chatbot. Each user brings their OWN free
   API key, which is stored only in their browser's localStorage.
   Supports: Google Gemini (native) + any OpenAI-compatible API (Groq,
   OpenRouter, custom).
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
        'Get a free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. Use a model ending in <code>:free</code>.',
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

  // ---- Element refs -----------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    messages: $("messages"),
    welcome: $("welcome"),
    input: $("input"),
    composer: $("composer"),
    sendBtn: $("sendBtn"),
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
      return;
    }
    el.welcome.style.display = "none";
    chat.messages.forEach((m) => el.messages.appendChild(messageEl(m.role, m.content)));
    el.headerTitle.textContent = chat.title;
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

  // ---- Sending a message ------------------------------------------------
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

    // Add user message
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

    // Typing indicator
    setBusy(true);
    const typingRow = typingIndicator();
    el.messages.appendChild(typingRow);
    scrollToBottom();

    try {
      const reply = await callAPI(chat.messages);
      typingRow.remove();
      chat.messages.push({ role: "assistant", content: reply });
      el.messages.appendChild(messageEl("assistant", reply));
      scrollToBottom();
      persist();
    } catch (err) {
      typingRow.remove();
      const msg = "⚠️ **Error:** " + (err.message || "Something went wrong.");
      chat.messages.push({ role: "assistant", content: msg });
      el.messages.appendChild(messageEl("assistant", msg));
      scrollToBottom();
      persist();
    } finally {
      setBusy(false);
    }
  }

  function typingIndicator() {
    const row = document.createElement("div");
    row.className = "msg-row bot";
    row.innerHTML = `<div class="avatar bot">🤖</div>
      <div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
    return row;
  }

  function setBusy(v) {
    busy = v;
    el.sendBtn.disabled = v;
  }

  // ---- API calls --------------------------------------------------------
  async function callAPI(messages) {
    const provider = PROVIDERS[settings.provider] || PROVIDERS.gemini;
    const model = activeModel();
    const system = settings.systemPrompt || DEFAULT_SYSTEM;

    if (provider.kind === "gemini") {
      return callGemini(model, system, messages);
    }
    const baseUrl = settings.baseUrl || provider.baseUrl;
    if (!baseUrl) throw new Error("No base URL configured for this provider.");
    return callOpenAICompatible(baseUrl, model, system, messages);
  }

  // Google Gemini native REST API
  async function callGemini(model, system, messages) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;

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
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `Gemini API error (${res.status})`);
    }
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = parts?.map((p) => p.text).join("") || "";
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason;
      throw new Error(reason ? `No response (${reason}).` : "Empty response from Gemini.");
    }
    return text;
  }

  // OpenAI-compatible Chat Completions (Groq, OpenRouter, custom, etc.)
  async function callOpenAICompatible(baseUrl, model, system, messages) {
    const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const body = {
      model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.7,
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.apiKey,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `API error (${res.status})`);
    }
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text) throw new Error("Empty response from the API.");
    return text;
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
    renderHistory();
    renderMessages();
    renderStatus();
    // First-run: nudge the user to set up their key.
    if (!settings.apiKey) {
      setTimeout(() => {
        openSettings();
      }, 400);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
