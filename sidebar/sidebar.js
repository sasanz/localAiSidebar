const modelSelect = globalThis.document?.getElementById("model-select");
const newChatBtn = globalThis.document?.getElementById("new-chat-btn");
const optionsBtn = globalThis.document?.getElementById("options-btn");
const includePageToggle = globalThis.document?.getElementById("include-page-toggle");
const pageStatus = globalThis.document?.getElementById("page-status");
const refreshPageBtn = globalThis.document?.getElementById("refresh-page-btn");
const chatMessages = globalThis.document?.getElementById("chat-messages");
const welcomeState = globalThis.document?.getElementById("welcome-state");
const userInput = globalThis.document?.getElementById("user-input");
const sendBtn = globalThis.document?.getElementById("send-btn");
const stopBtn = globalThis.document?.getElementById("stop-btn");
const attachBtn = globalThis.document?.getElementById("attach-btn");
const fileInput = globalThis.document?.getElementById("file-input");
const attachmentList = globalThis.document?.getElementById("attachment-list");

let conversationHistory = [];
let pendingAttachments = [];
let currentPageContext = null;
let activePort = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(text) {
  const codeBlocks = [];
  let src = String(text).replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`) - 1;
    return `@@CODEBLOCK_${idx}@@`;
  });

  const lines = src.split("\n");
  const out = [];
  let i = 0;

  const formatInline = (str) => {
    let s = escapeHtml(str).replace(/&lt;br\s*\/?&gt;/gi, "<br>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return s;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      const headers = line.trim().replace(/^\|+|\|+$/g, "").split("|").map((c) => formatInline(c.trim()));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\|+|\|+$/g, "").split("|").map((c) => formatInline(c.trim()));
        rows.push(cells);
        i++;
      }
      let tableHtml = '<div class="table-wrap"><table><thead><tr>' + headers.map((h) => `<th>${h}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of rows) {
        tableHtml += "<tr>" + headers.map((_h, idx) => `<td>${r[idx] || ""}</td>`).join("") + "</tr>";
      }
      tableHtml += "</tbody></table></div>";
      out.push(tableHtml);
      continue;
    }

    const hMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (hMatch) {
      const level = hMatch[1].length + 1;
      out.push(`<h${level}>${formatInline(hMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    out.push(formatInline(line));
    i++;
  }

  let html = out.join("<br>").replace(/(<br>)+(<div class="table-wrap">|<h[234]>|<hr>)/g, "$2").replace(/(<\/div>|<\/h[234]>|<hr>)(<br>)+/g, "$1");
  html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (_m, idx) => codeBlocks[Number(idx)] || "");
  return html;
}

function renderAttachments() {
  if (!attachmentList) return;
  attachmentList.innerHTML = "";
  if (pendingAttachments.length === 0) {
    attachmentList.hidden = true;
    return;
  }
  attachmentList.hidden = false;
  pendingAttachments.forEach((att, idx) => {
    const pill = document.createElement("div");
    pill.className = "attachment-pill";
    pill.innerHTML = `<span>${escapeHtml(att.name)}</span><button type="button" title="Remove">×</button>`;
    pill.querySelector("button").addEventListener("click", () => {
      pendingAttachments.splice(idx, 1);
      renderAttachments();
    });
    attachmentList.appendChild(pill);
  });
}

function setStreamingState(isStreaming) {
  if (sendBtn) sendBtn.hidden = isStreaming;
  if (stopBtn) stopBtn.hidden = !isStreaming;
}

function normalizeBaseUrl(rawUrl) {
  let u = String(rawUrl || "http://127.0.0.1:1234/v1").trim().replace(/\/+$/, "");
  if (!u.endsWith("/v1")) u += "/v1";
  return u;
}

async function loadModels() {
  const api = globalThis.browser || globalThis.chrome;
  try {
    let models = [];
    if (api?.runtime?.sendMessage) {
      const res = await api.runtime.sendMessage({ type: "FETCH_MODELS" }).catch(() => null);
      if (Array.isArray(res?.models)) {
        models = res.models;
      } else if (Array.isArray(res?.models?.data)) {
        models = res.models.data.map((m) => m.id || m);
      }
    }

    // Fallback: query storage + /models directly if service worker was still waking up
    if (models.length === 0 && api?.storage?.local?.get && typeof globalThis.fetch === "function") {
      const stored = await api.storage.local.get({ baseUrl: "http://127.0.0.1:1234/v1" });
      const baseUrl = normalizeBaseUrl(stored?.baseUrl);
      const directRes = await globalThis.fetch(`${baseUrl}/models`);
      if (directRes.ok) {
        const data = await directRes.json();
        if (Array.isArray(data?.data)) models = data.data.map((m) => m.id).filter(Boolean);
        else if (Array.isArray(data?.models)) models = data.models.map((m) => m.name || m.id).filter(Boolean);
      }
    }

    const selectEl = globalThis.document?.getElementById("model-select");
    if (!selectEl) return models;
    while (selectEl.options.length > 1) selectEl.remove(1);
    models.forEach((id) => {
      const opt = globalThis.document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      selectEl.appendChild(opt);
    });
    return models;
  } catch (err) {
    console.error("Failed to load models:", err);
    return [];
  }
}

async function refreshPageContext() {
  if (pageStatus) pageStatus.textContent = "Reading current tab...";
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT" });
    if (res?.error) {
      currentPageContext = null;
      if (pageStatus) pageStatus.textContent = res.error;
    } else if (res?.text) {
      currentPageContext = res;
      if (pageStatus) pageStatus.textContent = res.title || res.url || "Page loaded";
    } else {
      currentPageContext = null;
      if (pageStatus) pageStatus.textContent = "No page content";
    }
  } catch (err) {
    currentPageContext = null;
    if (pageStatus) pageStatus.textContent = "Page unavailable";
  }
}

function appendBubble(role, htmlContent) {
  if (welcomeState) welcomeState.style.display = "none";
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.innerHTML = htmlContent;
  chatMessages?.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
  return div;
}

async function sendMessage(overrideText) {
  const text = (typeof overrideText === "string" ? overrideText : userInput?.value || "").trim();
  if ((!text && pendingAttachments.length === 0) || activePort) return;

  const currentFiles = [...pendingAttachments];
  pendingAttachments = [];
  renderAttachments();

  if (userInput) {
    userInput.value = "";
    userInput.style.height = "auto";
  }

  let userHtml = "";
  if (currentFiles.length > 0) {
    const badges = currentFiles
      .map((f) => {
        if (f.kind === "image") {
          return `<span class="msg-attachment-badge">${escapeHtml(f.name)}</span><img class="msg-attachment-thumb" src="${f.dataUrl}" alt="${escapeHtml(f.name)}">`;
        }
        return `<span class="msg-attachment-badge">${escapeHtml(f.name)}</span>`;
      })
      .join("");
    userHtml += `<div class="msg-attachments">${badges}</div>`;
  }
  if (text) {
    userHtml += escapeHtml(text).replace(/\n/g, "<br>");
  }

  appendBubble("user", userHtml);

  const parser = globalThis.FileParser || require("./file-parser.js");
  const userMessage = parser.buildUserMessagePayload(text, currentFiles);
  conversationHistory.push(userMessage);

  if (includePageToggle?.checked && !currentPageContext) {
    await refreshPageContext();
  }

  const assistantBubble = appendBubble("assistant", "<em>Thinking...</em>");
  let assistantText = "";
  setStreamingState(true);

  const port = chrome.runtime.connect({ name: "ai-stream" });
  activePort = port;

  port.onMessage.addListener((msg) => {
    if (msg.type === "THINKING" && !assistantText) {
      assistantBubble.innerHTML = "<em>Thinking...</em>";
    } else if (msg.type === "CHUNK") {
      assistantText += msg.content || "";
      assistantBubble.innerHTML = renderMarkdown(assistantText);
      assistantBubble.scrollIntoView({ behavior: "smooth", block: "end" });
    } else if (msg.type === "DONE") {
      if (assistantText) {
        conversationHistory.push({ role: "assistant", content: assistantText });
      }
      activePort = null;
      setStreamingState(false);
      port.disconnect();
    } else if (msg.type === "ERROR") {
      assistantBubble.innerHTML = `<span style="color:#f28b82;">Error: ${escapeHtml(msg.error || "Unknown error")}</span>`;
      activePort = null;
      setStreamingState(false);
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    activePort = null;
    setStreamingState(false);
  });

  port.postMessage({
    action: "CHAT",
    messages: conversationHistory,
    pageContext: includePageToggle?.checked ? currentPageContext : null,
    modelOverride: modelSelect?.value || ""
  });
}

attachBtn?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    try {
      const parsed = await globalThis.FileParser.parseAttachment(file);
      pendingAttachments.push(parsed);
    } catch (err) {
      appendBubble("assistant", `<span style="color:#f28b82;">Attachment error: ${escapeHtml(err.message)}</span>`);
    }
  }
  fileInput.value = "";
  renderAttachments();
});

sendBtn?.addEventListener("click", () => sendMessage());

stopBtn?.addEventListener("click", () => {
  if (activePort) {
    activePort.postMessage({ action: "STOP" });
    activePort.disconnect();
    activePort = null;
  }
  setStreamingState(false);
});

userInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

(globalThis.document?.querySelectorAll(".prompt-chip") || []).forEach((chip) => {
  chip.addEventListener("click", () => sendMessage(chip.textContent.trim()));
});

newChatBtn?.addEventListener("click", () => {
  if (activePort) {
    activePort.postMessage({ action: "STOP" });
    activePort.disconnect();
    activePort = null;
  }
  setStreamingState(false);
  conversationHistory = [];
  pendingAttachments = [];
  renderAttachments();
  chatMessages?.querySelectorAll(".message").forEach((el) => el.remove());
  if (welcomeState) welcomeState.style.display = "flex";
});

optionsBtn?.addEventListener("click", () => chrome.runtime.openOptionsPage());
refreshPageBtn?.addEventListener("click", () => refreshPageContext());

(globalThis.browser || globalThis.chrome)?.tabs?.onActivated?.addListener(() => refreshPageContext());
(globalThis.browser || globalThis.chrome)?.tabs?.onUpdated?.addListener((_tabId, info) => {
  if (info.status === "complete") refreshPageContext();
});

globalThis.document?.addEventListener("DOMContentLoaded", () => {
  loadModels();
  refreshPageContext();
});

if (typeof module !== "undefined") {
  module.exports = { renderMarkdown, escapeHtml, loadModels, normalizeBaseUrl };
}

// Reload models automatically when baseUrl changes in storage or after service worker wake-up
(globalThis.browser || globalThis.chrome)?.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.baseUrl && typeof loadModels === "function") {
    loadModels();
  }
});
setTimeout(() => {
  if (modelSelect && modelSelect.options.length <= 1 && typeof loadModels === "function") {
    loadModels();
  }
}, 300);