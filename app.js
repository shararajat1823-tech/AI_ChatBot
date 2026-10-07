/* =========================================================================
   AI ChatBot — front-end logic
   A static, GitHub-Pages-hostable chatbot. Each user brings their OWN free
   API key, stored only in their browser's localStorage.

   Providers: Google Gemini (native) + any OpenAI-compatible API
   (Groq, OpenRouter, custom).

   Features: streaming replies, stop/regenerate, request timeout + friendly
   errors, voice input & output, image (vision) input, edit/copy messages,
   and an in-header model picker.
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

  // Suggested models shown in the header dropdown (users can still set any in Settings).
  const MODELS = {
    gemini: ["gemini-flash-latest", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro-latest"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
    openrouter: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
      "mistralai/mistral-7b-instruct:free",
    ],
    custom: [],
  };

  const DEFAULT_SYSTEM = "You are a helpful, friendly, and concise AI assistant.";
  const TIMEOUT_TEXT = 60000; // time-to-first-token budget for text
  const TIMEOUT_IMAGE = 120000; // vision requests legitimately take longer
  const IMG_MAX_DIM = 1024; // downscale attachments to this max side
  const IMG_QUALITY = 0.8; // JPEG quality for attachments

  // ---- State ------------------------------------------------------------
  const LS = { settings: "aichatbot.settings", chats: "aichatbot.chats", theme: "aichatbot.theme" };

  let settings = loadJSON(LS.settings, {
    provider: "gemini",
    apiKey: "",
    model: "",
    baseUrl: "",
    systemPrompt: DEFAULT_SYSTEM,
    autoSpeak: false,
  });

  let chats = loadJSON(LS.chats, []); // [{id, title, messages:[{role, content, images?}]}]
  let currentId = chats.length ? chats[0].id : null;
  let busy = false;
  let currentAbort = null;
  let stopRequested = false;
  let timedOut = false;
  let pendingImages = []; // data-URLs attached to the next message

  // ---- Element refs -----------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    messages: $("messages"), welcome: $("welcome"), input: $("input"), composer: $("composer"),
    sendBtn: $("sendBtn"), micBtn: $("micBtn"), attachBtn: $("attachBtn"), fileInput: $("fileInput"),
    attachments: $("attachments"), actionBar: $("actionBar"), regenBtn: $("regenBtn"),
    historyList: $("historyList"), headerTitle: $("headerTitle"),
    providerLabel: $("providerLabel"), modelSelect: $("modelSelect"),
    newChatBtn: $("newChatBtn"), sidebar: $("sidebar"), openSidebar: $("openSidebar"), closeSidebar: $("closeSidebar"),
    openSettings: $("openSettings"), closeSettings: $("closeSettings"), settingsBackdrop: $("settingsBackdrop"),
    saveSettings: $("saveSettings"), clearData: $("clearData"), themeToggle: $("themeToggle"),
    provider: $("provider"), apiKey: $("apiKey"), model: $("model"), baseUrl: $("baseUrl"),
    baseUrlRow: $("baseUrlRow"), systemPrompt: $("systemPrompt"), autoSpeak: $("autoSpeak"),
    keyHint: $("keyHint"), toggleKey: $("toggleKey"), toast: $("toast"),
  };

  // ---- Helpers ----------------------------------------------------------
  function loadJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.toast.hidden = true), 3200);
  }

  const currentChat = () => chats.find((c) => c.id === currentId) || null;
  function activeModel() {
    const p = PROVIDERS[settings.provider] || PROVIDERS.gemini;
    return settings.model || p.defaultModel;
  }

  // Persist chats; if images blow the storage quota, fall back to saving without image blobs.
  function persist() {
    try {
      localStorage.setItem(LS.chats, JSON.stringify(chats));
    } catch {
      try {
        const light = chats.map((c) => ({
          ...c,
          messages: c.messages.map((m) => (m.images && m.images.length ? { ...m, images: [] } : m)),
        }));
        localStorage.setItem(LS.chats, JSON.stringify(light));
      } catch {}
    }
  }

  // ---- Rendering --------------------------------------------------------
  function populateModelSelect() {
    const prov = settings.provider;
    const list = [...(MODELS[prov] || [])];
    const cur = activeModel();
    if (cur && !list.includes(cur)) list.unshift(cur);
    el.modelSelect.innerHTML = "";
    if (!list.length) {
      const o = document.createElement("option");
      o.textContent = "(set model in Settings)"; o.disabled = true;
      el.modelSelect.appendChild(o);
    } else {
      list.forEach((m) => {
        const o = document.createElement("option");
        o.value = m; o.textContent = m;
        el.modelSelect.appendChild(o);
      });
      el.modelSelect.value = cur;
    }
    const label = PROVIDERS[prov] ? PROVIDERS[prov].label : "AI";
    el.providerLabel.textContent = (settings.apiKey ? "" : "⚠️ ") + label;
    el.providerLabel.style.color = settings.apiKey ? "" : "var(--danger)";
  }

  function renderHistory() {
    el.historyList.innerHTML = "";
    chats.forEach((c) => {
      const item = document.createElement("div");
      item.className = "history-item" + (c.id === currentId ? " active" : "");
      item.innerHTML = `<span class="label">💬 ${escapeHtml(c.title)}</span>
        <button class="del" title="Delete" aria-label="Delete chat">🗑️</button>`;
      item.querySelector(".label").onclick = () => selectChat(c.id);
      item.querySelector(".del").onclick = (e) => { e.stopPropagation(); deleteChat(c.id); };
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
    chat.messages.forEach((m, i) => el.messages.appendChild(messageEl(m, i)));
    el.headerTitle.textContent = chat.title;
    updateActionBar();
    scrollToBottom();
  }

  // Build one message row (avatar + bubble + hover actions).
  function messageEl(m, index) {
    const isUser = m.role === "user";
    const row = document.createElement("div");
    row.className = `msg-row ${isUser ? "user" : "bot"}`;

    const avatar = document.createElement("div");
    avatar.className = `avatar ${isUser ? "user" : "bot"}`;
    avatar.textContent = isUser ? "🧑" : "🤖";

    const col = document.createElement("div");
    col.className = "bubble-col";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (m.images && m.images.length) {
      m.images.forEach((src) => {
        const img = document.createElement("img");
        img.className = "msg-img"; img.src = src; img.alt = "attached image";
        bubble.appendChild(img);
      });
    }
    if (isUser) {
      if (m.content) bubble.appendChild(document.createTextNode(m.content));
    } else {
      const span = document.createElement("div");
      span.innerHTML = renderMarkdown(m.content);
      enhanceCodeBlocks(span);
      bubble.appendChild(span);
    }
    col.appendChild(bubble);

    // Hover action buttons
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    if (m.content) {
      const copy = actBtn("📋 Copy", () => {
        navigator.clipboard.writeText(m.content).then(() => toast("Copied!"));
      });
      actions.appendChild(copy);
    }
    if (isUser) {
      actions.appendChild(actBtn("✏️ Edit", () => editMessage(index)));
    } else if (m.content) {
      const speak = actBtn("🔊 Speak", () => toggleSpeak(m.content, speak));
      actions.appendChild(speak);
    }
    col.appendChild(actions);

    row.appendChild(avatar);
    row.appendChild(col);
    return row;
  }

  function actBtn(label, onClick) {
    const b = document.createElement("button");
    b.className = "msg-act"; b.type = "button"; b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  function renderMarkdown(text) {
    if (window.marked) {
      try { return window.marked.parse(text, { breaks: true, gfm: true }); } catch {}
    }
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function enhanceCodeBlocks(container) {
    container.querySelectorAll("pre code").forEach((code) => {
      if (window.hljs) { try { window.hljs.highlightElement(code); } catch {} }
      const pre = code.parentElement;
      if (pre.querySelector(".code-head")) return;
      const head = document.createElement("div");
      head.className = "code-head";
      const lang = (code.className.match(/language-(\w+)/) || [, "code"])[1];
      head.innerHTML = `<span>${lang}</span><button class="copy-btn">Copy</button>`;
      head.querySelector(".copy-btn").onclick = () =>
        navigator.clipboard.writeText(code.textContent).then(() => toast("Copied!"));
      pre.insertBefore(head, code);
    });
  }

  function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function scrollToBottom() { el.messages.scrollTop = el.messages.scrollHeight; }

  function updateActionBar() {
    const chat = currentChat();
    const lastIsBot = chat && chat.messages.length && chat.messages[chat.messages.length - 1].role === "assistant";
    el.actionBar.hidden = !(lastIsBot && !busy);
  }

  // ---- Attachments (image input) ----------------------------------------
  function handleFiles(files) {
    [...files].forEach((f) => {
      if (!f.type.startsWith("image/")) return;
      compressImage(f).then((dataUrl) => { pendingImages.push(dataUrl); renderAttachments(); });
    });
  }

  // Downscale + re-encode an image so vision payloads stay small and fast.
  function compressImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > IMG_MAX_DIM || height > IMG_MAX_DIM) {
            const scale = IMG_MAX_DIM / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          try {
            const canvas = document.createElement("canvas");
            canvas.width = width; canvas.height = height;
            canvas.getContext("2d").drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", IMG_QUALITY));
          } catch {
            resolve(reader.result); // fallback to original on any canvas error
          }
        };
        img.onerror = () => resolve(reader.result);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderAttachments() {
    el.attachments.innerHTML = "";
    el.attachments.hidden = pendingImages.length === 0;
    pendingImages.forEach((src, i) => {
      const thumb = document.createElement("div");
      thumb.className = "attach-thumb";
      thumb.innerHTML = `<img src="${src}" alt="attachment" /><button class="rm" title="Remove">✕</button>`;
      thumb.querySelector(".rm").onclick = () => {
        pendingImages.splice(i, 1);
        renderAttachments();
      };
      el.attachments.appendChild(thumb);
    });
  }

  // ---- Chat management --------------------------------------------------
  function newChat() {
    stopSpeak();
    const chat = { id: uid(), title: "New chat", messages: [] };
    chats.unshift(chat); currentId = chat.id;
    pendingImages = []; renderAttachments();
    persist(); renderHistory(); renderMessages(); populateModelSelect(); closeSidebarMobile();
    el.input.focus();
  }
  function selectChat(id) { stopSpeak(); currentId = id; renderHistory(); renderMessages(); closeSidebarMobile(); }
  function deleteChat(id) {
    chats = chats.filter((c) => c.id !== id);
    if (currentId === id) currentId = chats.length ? chats[0].id : null;
    persist(); renderHistory(); renderMessages();
  }

  function editMessage(index) {
    const chat = currentChat();
    if (!chat || busy) return;
    const m = chat.messages[index];
    el.input.value = m.content || "";
    pendingImages = (m.images || []).slice();
    renderAttachments();
    autoResize();
    chat.messages = chat.messages.slice(0, index); // drop this msg and everything after
    persist(); renderMessages(); el.input.focus();
    toast("Edit your message, then send again");
  }

  // ---- Sending / generating ---------------------------------------------
  async function sendMessage(text) {
    text = (text || "").trim();
    if ((!text && pendingImages.length === 0) || busy) return;

    if (!settings.apiKey) { openSettings(); toast("Add your free API key first 🔑"); return; }

    let chat = currentChat();
    if (!chat) { newChat(); chat = currentChat(); }

    const msg = { role: "user", content: text };
    if (pendingImages.length) msg.images = pendingImages.slice();
    chat.messages.push(msg);
    pendingImages = []; renderAttachments();

    if (chat.title === "New chat") {
      chat.title = (text || "Image").slice(0, 40) + (text.length > 40 ? "…" : "");
    }
    el.welcome.style.display = "none";
    el.messages.appendChild(messageEl(msg, chat.messages.length - 1));
    el.headerTitle.textContent = chat.title;
    renderHistory(); scrollToBottom(); persist();

    await generateReply(chat);
  }

  function regenerate() {
    const chat = currentChat();
    if (!chat || busy) return;
    while (chat.messages.length && chat.messages[chat.messages.length - 1].role === "assistant") chat.messages.pop();
    if (!chat.messages.some((m) => m.role === "user")) return;
    persist(); renderMessages();
    generateReply(chat);
  }

  async function generateReply(chat) {
    setBusy(true);
    stopRequested = false; timedOut = false;

    const row = document.createElement("div");
    row.className = "msg-row bot";
    row.innerHTML = `<div class="avatar bot">🤖</div><div class="bubble-col"><div class="bubble"></div></div>`;
    const bubble = row.querySelector(".bubble");
    bubble.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
    el.messages.appendChild(row); scrollToBottom();

    currentAbort = new AbortController();
    let acc = "", gotFirst = false, lastPaint = 0;

    const paint = (force) => {
      const now = Date.now();
      if (!force && now - lastPaint < 60) return;
      lastPaint = now;
      bubble.innerHTML = renderMarkdown(acc) + '<span class="stream-cursor"></span>';
      scrollToBottom();
    };

    const hasImages = chat.messages.some((m) => m.images && m.images.length);
    const timeoutMs = hasImages ? TIMEOUT_IMAGE : TIMEOUT_TEXT;
    let timer = setTimeout(fireTimeout, timeoutMs);
    function fireTimeout() { timedOut = true; if (currentAbort) currentAbort.abort(); }
    const kick = () => { clearTimeout(timer); timer = setTimeout(fireTimeout, timeoutMs); };

    const onDelta = (chunk) => {
      if (!chunk) return;
      if (!gotFirst) { gotFirst = true; bubble.innerHTML = ""; }
      acc += chunk; kick(); paint(false);
    };

    try {
      await callAPIStream(chat.messages, onDelta, currentAbort.signal);
      clearTimeout(timer);
      chat.messages.push({ role: "assistant", content: acc || "_(empty response)_" });
      persist(); renderMessages();
      if (settings.autoSpeak && acc) toggleSpeak(acc, null, true);
    } catch (err) {
      clearTimeout(timer);
      let msg;
      if (stopRequested && acc) msg = acc + "\n\n_⏹ Stopped._";
      else if (timedOut)
        msg = (acc ? acc + "\n\n" : "") +
          "⚠️ **Request timed out.** The provider didn't respond in time. Check your model name/key, or try again.";
      else msg = "⚠️ " + friendlyError(err);
      chat.messages.push({ role: "assistant", content: msg });
      persist(); renderMessages();
    } finally {
      currentAbort = null; setBusy(false);
    }
  }

  function stopGeneration() {
    if (!busy || !currentAbort) return;
    stopRequested = true; currentAbort.abort();
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
    el.sendBtn.classList.toggle("stop", v);
    el.sendBtn.textContent = v ? "■" : "➤";
    el.sendBtn.title = v ? "Stop" : "Send";
    updateActionBar();
  }

  // ---- API calls (streaming) --------------------------------------------
  async function callAPIStream(messages, onDelta, signal) {
    const provider = PROVIDERS[settings.provider] || PROVIDERS.gemini;
    const model = activeModel();
    const system = settings.systemPrompt || DEFAULT_SYSTEM;
    if (provider.kind === "gemini") return streamGemini(model, system, messages, onDelta, signal);
    const baseUrl = settings.baseUrl || provider.baseUrl;
    if (!baseUrl) throw new Error("No base URL configured for this provider.");
    return streamOpenAI(baseUrl, model, system, messages, onDelta, signal);
  }

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
        try { onDelta(extract(JSON.parse(data))); } catch {}
      }
    }
  }

  async function errorFromResponse(res, label) {
    let data = {};
    try { data = await res.json(); } catch {}
    return new Error(`${label}: ${data?.error?.message || data?.message || "HTTP " + res.status}`);
  }

  // Turn a data-URL into a Gemini inlineData part.
  function inlineData(dataUrl) {
    const [meta, b64] = dataUrl.split(",");
    const mime = (meta.match(/data:(.*?);base64/) || [, "image/png"])[1];
    return { inlineData: { mimeType: mime, data: b64 } };
  }

  async function streamGemini(model, system, messages, onDelta, signal) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:streamGenerateContent?alt=sse&key=${encodeURIComponent(settings.apiKey)}`;

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        ...(m.images || []).map(inlineData),
        ...(m.content ? [{ text: m.content }] : []),
      ],
    }));

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { temperature: 0.7 },
      }),
      signal,
    });
    if (!res.ok) throw await errorFromResponse(res, "Gemini API error");
    await readSSE(res, (j) => j?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "", onDelta);
  }

  async function streamOpenAI(baseUrl, model, system, messages, onDelta, signal) {
    const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const mapped = messages.map((m) => {
      if (m.images && m.images.length) {
        return {
          role: m.role,
          content: [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...m.images.map((u) => ({ type: "image_url", image_url: { url: u } })),
          ],
        };
      }
      return { role: m.role, content: m.content };
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + settings.apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...mapped],
        temperature: 0.7,
        stream: true,
      }),
      signal,
    });
    if (!res.ok) throw await errorFromResponse(res, "API error");
    await readSSE(res, (j) => j?.choices?.[0]?.delta?.content || "", onDelta);
  }

  // ---- Voice input (speech-to-text) -------------------------------------
  let recognition = null, listening = false;
  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { el.micBtn.hidden = true; return; }
    el.micBtn.hidden = false;
    recognition = new SR();
    recognition.lang = "en-US"; recognition.interimResults = true; recognition.continuous = false;
    let baseText = "";
    recognition.onstart = () => {
      listening = true; baseText = el.input.value ? el.input.value + " " : "";
      el.micBtn.classList.add("listening"); el.micBtn.title = "Stop listening";
    };
    recognition.onresult = (e) => {
      let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      el.input.value = baseText + t; autoResize();
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("🎤 Microphone permission denied");
    };
    recognition.onend = () => {
      listening = false; el.micBtn.classList.remove("listening"); el.micBtn.title = "Voice input"; el.input.focus();
    };
  }
  function toggleVoice() {
    if (!recognition) return;
    if (listening) recognition.stop();
    else { try { recognition.start(); } catch {} }
  }

  // ---- Voice output (text-to-speech) ------------------------------------
  let speakingBtn = null;
  function stopSpeak() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (speakingBtn) { speakingBtn.textContent = "🔊 Speak"; speakingBtn = null; }
  }
  function toggleSpeak(text, btn, auto) {
    if (!window.speechSynthesis) { if (!auto) toast("Speech not supported in this browser"); return; }
    // Clicking the same speaking button stops it.
    if (btn && btn === speakingBtn) { stopSpeak(); return; }
    stopSpeak();
    const clean = text
      .replace(/```[\s\S]*?```/g, ". code block. ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_#>~]/g, "");
    const u = new SpeechSynthesisUtterance(clean);
    u.onend = () => { if (btn) btn.textContent = "🔊 Speak"; speakingBtn = null; };
    if (btn) { btn.textContent = "⏹ Stop"; speakingBtn = btn; }
    window.speechSynthesis.speak(u);
  }

  // ---- Settings UI ------------------------------------------------------
  function openSettings() {
    el.provider.value = settings.provider;
    el.apiKey.value = settings.apiKey;
    el.model.value = settings.model;
    el.baseUrl.value = settings.baseUrl;
    el.systemPrompt.value = settings.systemPrompt;
    el.autoSpeak.checked = !!settings.autoSpeak;
    syncProviderUI();
    el.settingsBackdrop.hidden = false;
  }
  function closeSettings() { el.settingsBackdrop.hidden = true; }

  function syncProviderUI() {
    const p = PROVIDERS[el.provider.value];
    el.keyHint.innerHTML = p.keyHint;
    const isCustom = el.provider.value === "custom";
    el.baseUrl.hidden = !isCustom; el.baseUrlRow.hidden = !isCustom;
    if (!el.model.value) el.model.placeholder = p.defaultModel || "model name";
  }

  function saveSettings() {
    settings.provider = el.provider.value;
    settings.apiKey = el.apiKey.value.trim();
    settings.model = el.model.value.trim();
    settings.baseUrl = el.baseUrl.value.trim();
    settings.systemPrompt = el.systemPrompt.value.trim() || DEFAULT_SYSTEM;
    settings.autoSpeak = el.autoSpeak.checked;
    saveJSON(LS.settings, settings);
    populateModelSelect(); closeSettings(); toast("Settings saved ✓");
  }

  function clearAllData() {
    if (!confirm("Delete all chats and settings from this browser? This cannot be undone.")) return;
    try { localStorage.removeItem(LS.settings); localStorage.removeItem(LS.chats); } catch {}
    chats = []; currentId = null; pendingImages = [];
    settings = { provider: "gemini", apiKey: "", model: "", baseUrl: "", systemPrompt: DEFAULT_SYSTEM, autoSpeak: false };
    renderHistory(); renderMessages(); renderAttachments(); populateModelSelect(); closeSettings();
    toast("All data cleared");
  }

  // ---- Theme ------------------------------------------------------------
  function initTheme() { document.documentElement.setAttribute("data-theme", localStorage.getItem(LS.theme) || "dark"); }
  function toggleTheme() {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(LS.theme, next); } catch {}
  }

  // ---- Sidebar (mobile) -------------------------------------------------
  const openSidebarMobile = () => el.sidebar.classList.add("open");
  const closeSidebarMobile = () => el.sidebar.classList.remove("open");

  // ---- Composer behavior ------------------------------------------------
  function autoResize() { el.input.style.height = "auto"; el.input.style.height = Math.min(el.input.scrollHeight, 180) + "px"; }

  // ---- Event wiring -----------------------------------------------------
  function bind() {
    el.composer.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) { stopGeneration(); return; }
      const text = el.input.value; el.input.value = ""; autoResize(); sendMessage(text);
    });
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.composer.requestSubmit(); }
    });
    el.input.addEventListener("input", autoResize);

    el.micBtn.addEventListener("click", toggleVoice);
    el.attachBtn.addEventListener("click", () => el.fileInput.click());
    el.fileInput.addEventListener("change", (e) => { handleFiles(e.target.files); el.fileInput.value = ""; });
    el.regenBtn.addEventListener("click", regenerate);

    el.modelSelect.addEventListener("change", () => {
      settings.model = el.modelSelect.value;
      saveJSON(LS.settings, settings);
      toast("Model → " + settings.model);
    });

    el.newChatBtn.addEventListener("click", newChat);
    el.openSettings.addEventListener("click", openSettings);
    el.closeSettings.addEventListener("click", closeSettings);
    el.saveSettings.addEventListener("click", saveSettings);
    el.clearData.addEventListener("click", clearAllData);
    el.themeToggle.addEventListener("click", toggleTheme);
    el.provider.addEventListener("change", () => { el.model.value = ""; syncProviderUI(); });
    el.toggleKey.addEventListener("click", () => {
      const show = el.apiKey.type === "password";
      el.apiKey.type = show ? "text" : "password";
      el.toggleKey.textContent = show ? "Hide" : "Show";
    });
    el.openSidebar.addEventListener("click", openSidebarMobile);
    el.closeSidebar.addEventListener("click", closeSidebarMobile);
    el.settingsBackdrop.addEventListener("click", (e) => { if (e.target === el.settingsBackdrop) closeSettings(); });

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
    initTheme(); bind(); initVoice();
    renderHistory(); renderMessages(); renderAttachments(); populateModelSelect();
    if (!settings.apiKey) setTimeout(openSettings, 400);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
