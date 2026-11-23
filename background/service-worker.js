const DEFAULT_SETTINGS = {
  provider: "lmstudio",
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "",
  systemPrompt: "You are a helpful AI assistant. Use the provided webpage context to answer the user's questions accurately and concisely.",
  maxContextChars: 12000
};

function isRestricted(url) {
  if (!url || typeof url !== "string") return true;
  return /^(chrome|edge|about|chrome-extension):/i.test(url);
}

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function fetchAvailableModels(customBaseUrl) {
  const settings = await getSettings();
  const baseUrl = (customBaseUrl || settings.baseUrl || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${baseUrl}/models`);
  const data = await res.json();
  if (Array.isArray(data?.data)) return data.data.map((m) => m.id).filter(Boolean);
  if (Array.isArray(data?.models)) return data.models.map((m) => m.name || m.id).filter(Boolean);
  return [];
}

chrome.action?.onClicked?.addListener((tab) => {
  if (chrome.sidePanel?.open && tab?.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FETCH_MODELS") {
    fetchAvailableModels(message.baseUrl)
      .then((models) => sendResponse({ ok: true, models }))
      .catch((err) => sendResponse({ ok: false, error: err.message, models: [] }));
    return true;
  }

  if (message?.type === "GET_PAGE_CONTEXT") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab || !tab.id || isRestricted(tab.url)) {
          sendResponse({ error: "Cannot read browser system pages." });
          return;
        }
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content/extractor.js"]
        });
        const result = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_TEXT" });
        sendResponse(result || { error: "Empty page response." });
      } catch (err) {
        sendResponse({ error: err.message || "Failed to read tab." });
      }
    })();
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ai-stream") return;
  let controller = null;

  port.onDisconnect.addListener(() => {
    if (controller) controller.abort();
  });

  port.onMessage.addListener(async (msg) => {
    if (msg?.action === "STOP") {
      if (controller) controller.abort();
      return;
    }

    if (msg?.action !== "CHAT") return;

    controller = new AbortController();

    try {
      const settings = await getSettings();
      const baseUrl = (settings.baseUrl || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, "");

      let model = (msg.modelOverride || settings.model || "").trim();
      if (!model) {
        const models = await fetchAvailableModels(baseUrl);
        model = models[0] || "";
      }
      if (!model) {
        port.postMessage({ type: "ERROR", error: "No model loaded in LM Studio / Ollama." });
        return;
      }

      let systemContent = settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt;
      if (msg.pageContext?.text) {
        const snippet = msg.pageContext.text.slice(0, Number(settings.maxContextChars) || 12000);
        systemContent += `\n\n--- CURRENT WEBPAGE CONTEXT ---\nTitle: ${msg.pageContext.title || ""}\nURL: ${msg.pageContext.url || ""}\nContent:\n${snippet}`;
      }

      const fullMessages = [{ role: "system", content: systemContent }, ...(msg.messages || [])];

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: fullMessages, stream: true }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errText = await response.text();
        port.postMessage({ type: "ERROR", error: `HTTP ${response.status}: ${errText}` });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            port.postMessage({ type: "DONE" });
            return;
          }
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta || {};
            if (delta.reasoning_content || delta.reasoning) {
              port.postMessage({ type: "THINKING" });
            }
            if (typeof delta.content === "string" && delta.content.length > 0) {
              port.postMessage({ type: "CHUNK", content: delta.content });
            }
          } catch {
            // Ignore partial JSON frames
          }
        }
      }

      port.postMessage({ type: "DONE" });
    } catch (err) {
      if (err.name !== "AbortError") {
        port.postMessage({ type: "ERROR", error: err.message || "Connection failed." });
      }
    }
  });
});
