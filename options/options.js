// Default settings for the Local AI Sidebar extension
const DEFAULT_SETTINGS = {
  provider: "lmstudio",
  baseUrl: "http://localhost:1234/v1",
  model: "",
  systemPrompt:
    "You are a helpful AI assistant. Use the provided webpage context to answer the user's questions accurately and concisely.",
  maxContextChars: 12000,
};

/**
 * Utility to get an element by ID, returning null if not found.
 */
function $(id) {
  return document.getElementById(id);
}

/**
 * Populate form fields with settings values.
 */
function populateForm(settings) {
  const providerEl = $("provider");
  const baseUrlEl = $("baseUrl");
  const modelEl = $("model");
  const systemPromptEl = $("systemPrompt");
  const maxContextCharsEl = $("maxContextChars");

  if (providerEl) providerEl.value = settings.provider;
  if (baseUrlEl) baseUrlEl.value = settings.baseUrl;
  if (modelEl) modelEl.value = settings.model;
  if (systemPromptEl) systemPromptEl.value = settings.systemPrompt;
  if (maxContextCharsEl)
    maxContextCharsEl.value = settings.maxContextChars;
}

/**
 * Load settings from chrome.storage.local, falling back to defaults.
 */
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      const settings = { ...DEFAULT_SETTINGS, ...items };
      populateForm(settings);
      resolve(settings);
    });
  });
}

async function loadModels() {
  const baseUrl = $("baseUrl")?.value || DEFAULT_SETTINGS.baseUrl;
  const res = await new Promise(resolve => chrome.runtime.sendMessage({ type: "FETCH_MODELS", baseUrl }, resolve));
  const statusEl = $("server-status");
  if (!statusEl) return;
  if (res?.ok) {
    statusEl.textContent = `Connected (${res.models.length} models)`;
    const modelEl = $("model");
    if (modelEl) {
      const firstOption = modelEl.options[0];
      modelEl.innerHTML = '';
      modelEl.appendChild(firstOption);
      res.models.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        modelEl.appendChild(opt);
      });
      const currentModel = $("model")?.value;
      // Preserve selection after repopulating options
      if (currentModel && modelEl.querySelector(`option[value="${currentModel}"]`)) {
        modelEl.value = currentModel;
      }
    }
  } else {
    statusEl.textContent = "Server not reachable";
    const modelEl = $("model");
    if (modelEl) {
      const firstOption = modelEl.options[0];
      modelEl.innerHTML = '';
      modelEl.appendChild(firstOption);
    }
  }
}

/**
 * Save current form values to storage.
 */
function saveSettings() {
  const provider = $("provider")?.value || DEFAULT_SETTINGS.provider;
  const baseUrl = $("baseUrl")?.value || DEFAULT_SETTINGS.baseUrl;
  const model = $("model")?.value || "";
  const systemPrompt = $("systemPrompt")?.value || DEFAULT_SETTINGS.systemPrompt;
  const maxContextChars = parseInt(
    $("maxContextChars")?.value,
    10
  );

  const settings = {
    provider,
    baseUrl,
    model,
    systemPrompt,
    maxContextChars: isNaN(maxContextChars) ? DEFAULT_SETTINGS.maxContextChars : maxContextChars,
  };

  chrome.storage.local.set(settings, () => {
    const statusMsg = $("status-msg");
    if (statusMsg) {
      statusMsg.textContent = "Settings saved.";
      setTimeout(() => {
        statusMsg.textContent = "";
      }, 2000);
    }
  });
}

/**
 * Reset form to default settings.
 */
function resetToDefaults() {
  populateForm(DEFAULT_SETTINGS);
  const statusMsg = $("status-msg");
  if (statusMsg) {
    statusMsg.textContent = "Reset to defaults.";
    setTimeout(() => {
      statusMsg.textContent = "";
    }, 2000);
  }
}

/**
 * Auto-switch baseUrl based on provider selection.
 */
function handleProviderChange() {
  const providerEl = $("provider");
  if (!providerEl) return;
  providerEl.addEventListener("change", (e) => {
    const value = e.target.value;
    const baseUrlEl = $("baseUrl");
    if (!baseUrlEl) return;
    if (value === "lmstudio") {
      baseUrlEl.value = "http://localhost:1234/v1";
    } else if (value === "ollama") {
      baseUrlEl.value = "http://127.0.0.1:11434/v1";
    }
    loadModels();
  });
}

/**
 * Set up event listeners for form submission and reset button.
 */
function setupEventListeners() {
  const form = $("#settings-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveSettings();
    });
  }

  const resetBtn = $("#reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      resetToDefaults();
    });
  }
}

// Initialize on DOMContentLoaded
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  handleProviderChange();
  setupEventListeners();
  await loadModels();

  const baseUrlEl = $("baseUrl");
  if (baseUrlEl) baseUrlEl.addEventListener('blur', loadModels);

  const refreshBtn = $("refresh-models-btn");
  if (refreshBtn) refreshBtn.addEventListener('click', loadModels);
});
