const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderMarkdown, escapeHtml, loadModels, normalizeBaseUrl } = require("../sidebar/sidebar.js");
const { classifyFile, extractTextFromDocxXml, buildUserMessagePayload } = require("../sidebar/file-parser.js");
const { isRestricted, fetchAvailableModels } = require("../background/service-worker.js");

const rootDir = path.resolve(__dirname, "..");

test("escapeHtml sanitizes HTML special characters", () => {
  assert.equal(escapeHtml("<script>alert('x')</script>"), "&lt;script&gt;alert('x')&lt;/script&gt;");
});

test("renderMarkdown converts pipe tables into HTML tables", () => {
  const md = "| ColA | ColB |\n|---|---|\n| Val1 | Val2 |";
  const html = renderMarkdown(md);
  assert.match(html, /<table><thead><tr><th>ColA<\/th><th>ColB<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>Val1<\/td><td>Val2<\/td>/);
});

test("renderMarkdown preserves code blocks safely", () => {
  const md = "```js\nconst a = 1 < 2;\n```";
  assert.equal(renderMarkdown(md), "<pre><code>const a = 1 &lt; 2;</code></pre>");
});

test("renderMarkdown formats bold text and <br> inside table cells", () => {
  const md = "| Rule | Detail |\n|---|---|\n| **Bold** | Line 1<br>Line 2 |";
  const html = renderMarkdown(md);
  assert.match(html, /<td><strong>Bold<\/strong><\/td><td>Line 1<br>Line 2<\/td>/);
});

test("classifyFile detects pdf, docx, text, and image files", () => {
  assert.equal(classifyFile({ name: "report.pdf", type: "application/pdf" }), "pdf");
  assert.equal(classifyFile({ name: "contract.docx", type: "" }), "docx");
  assert.equal(classifyFile({ name: "notes.md", type: "text/markdown" }), "text");
  assert.equal(classifyFile({ name: "photo.jpg", type: "image/jpeg" }), "image");
  assert.equal(classifyFile({ name: "photo.png", type: "image/png" }), "image");
  assert.equal(classifyFile({ name: "archive.zip", type: "application/zip" }), "unsupported");
});

test("extractTextFromDocxXml extracts paragraphs cleanly", () => {
  const xml = "<w:document><w:body><w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>World</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>";
  assert.equal(extractTextFromDocxXml(xml), "Hello World\nSecond line");
});

test("buildUserMessagePayload builds plain string for text docs and multimodal array for images", () => {
  const textMsg = buildUserMessagePayload("Summarize", [{ name: "a.txt", kind: "text", text: "Doc body" }]);
  assert.equal(textMsg.role, "user");
  assert.match(textMsg.content, /Summarize[\s\S]*ATTACHED FILE: a\.txt \(TEXT\)[\s\S]*Doc body/);

  const imgMsg = buildUserMessagePayload("Describe", [{ name: "pic.jpg", kind: "image", dataUrl: "data:image/jpeg;base64,AAA" }]);
  assert.equal(Array.isArray(imgMsg.content), true);
  assert.equal(imgMsg.content[0].type, "text");
  assert.equal(imgMsg.content[1].type, "image_url");
  assert.equal(imgMsg.content[1].image_url.url, "data:image/jpeg;base64,AAA");
});

test("normalizeBaseUrl ensures /v1 suffix without duplicate slashes", () => {
  assert.equal(normalizeBaseUrl("http://127.0.0.1:1234"), "http://127.0.0.1:1234/v1");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:1234/"), "http://127.0.0.1:1234/v1");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:1234/v1/"), "http://127.0.0.1:1234/v1");
});

test("isRestricted blocks Chrome, Edge, Firefox, and extension internal URLs", () => {
  assert.equal(isRestricted(""), true);
  assert.equal(isRestricted("chrome://extensions"), true);
  assert.equal(isRestricted("edge://extensions"), true);
  assert.equal(isRestricted("about:debugging#/runtime/this-firefox"), true);
  assert.equal(isRestricted("chrome-extension://abc/sidebar.html"), true);
  assert.equal(isRestricted("moz-extension://def/sidebar.html"), true);
  assert.equal(isRestricted("https://en.wikipedia.org/wiki/Reza_Shah"), false);
});

test("Edge/Chrome manifest.json is strictly valid for sidePanel click opening", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions.includes("sidePanel"), true);
  assert.equal(manifest.side_panel?.default_path, "sidebar/sidebar.html");
  assert.equal(fs.existsSync(path.join(rootDir, manifest.side_panel.default_path)), true);
  assert.equal(manifest.action?.default_popup, undefined, "default_popup must not be set when using openPanelOnActionClick");
  assert.equal(manifest.background?.service_worker, "background/service-worker.js");
  assert.equal(manifest.background?.scripts, undefined);
});

test("Firefox dist/firefox/manifest.json is strictly valid for sidebar_action and active tab reading", () => {
  const ffManifest = JSON.parse(fs.readFileSync(path.join(rootDir, "dist", "firefox", "manifest.json"), "utf8"));
  assert.equal(ffManifest.manifest_version, 3);
  assert.deepEqual(ffManifest.background?.scripts, ["background/service-worker.js"]);
  assert.equal(ffManifest.background?.service_worker, undefined);
  assert.equal(ffManifest.sidebar_action?.default_panel, "sidebar/sidebar.html");
  assert.equal(ffManifest.host_permissions.includes("<all_urls>"), true);
  assert.ok(ffManifest.browser_specific_settings?.gecko?.id);
});

test("Edge/Chrome service worker sets openPanelOnActionClick=true without overriding action.onClicked", () => {
  const swModulePath = require.resolve("../background/service-worker.js");
  delete require.cache[swModulePath];
  delete globalThis.browser;

  let panelBehavior = null;
  let actionClickedListeners = 0;
  globalThis.chrome = {
    sidePanel: {
      setOptions: async () => {},
      setPanelBehavior: async (opts) => { panelBehavior = opts; }
    },
    runtime: {
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} },
      onConnect: { addListener: () => {} }
    },
    action: {
      onClicked: { addListener: () => { actionClickedListeners++; } }
    }
  };

  require("../background/service-worker.js");
  assert.deepEqual(panelBehavior, { openPanelOnActionClick: true });
  assert.equal(actionClickedListeners, 0, "Chromium/Edge must not attach action.onClicked when using openPanelOnActionClick");

  delete globalThis.chrome;
  delete require.cache[swModulePath];
});

test("Firefox background script wires action.onClicked to browser.sidebarAction.toggle()", () => {
  const swModulePath = require.resolve("../background/service-worker.js");
  delete require.cache[swModulePath];
  delete globalThis.chrome;

  let toggled = false;
  let clickHandler = null;
  globalThis.browser = {
    sidebarAction: {
      toggle: () => { toggled = true; }
    },
    runtime: {
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} },
      onConnect: { addListener: () => {} }
    },
    action: {
      onClicked: { addListener: (fn) => { clickHandler = fn; } }
    }
  };

  require("../background/service-worker.js");
  assert.equal(typeof clickHandler, "function");
  clickHandler();
  assert.equal(toggled, true);

  delete globalThis.browser;
  delete require.cache[swModulePath];
});

test("loadModels populates select via runtime message and falls back to direct storage+fetch when worker is asleep", async () => {
  const options = [{ value: "", textContent: "Auto Model" }];
  const fakeSelect = {
    options,
    remove(idx) { options.splice(idx, 1); },
    appendChild(opt) { options.push(opt); }
  };

  globalThis.document = {
    getElementById: (id) => (id === "model-select" ? fakeSelect : null),
    createElement: () => ({ value: "", textContent: "" })
  };

  globalThis.chrome = {
    runtime: { sendMessage: async () => ({ ok: true, models: ["gpt-oss-20b"] }) }
  };
  await loadModels();
  assert.equal(options.map((o) => o.textContent).includes("gpt-oss-20b"), true);

  globalThis.browser = {
    runtime: { sendMessage: async () => ({ ok: false, models: [] }) },
    storage: { local: { get: async () => ({ baseUrl: "http://127.0.0.1:9999" }) } }
  };
  globalThis.fetch = async (url) => {
    assert.equal(url, "http://127.0.0.1:9999/v1/models");
    return {
      ok: true,
      json: async () => ({ data: [{ id: "mock-local-model" }] })
    };
  };

  await loadModels();
  assert.equal(options.map((o) => o.textContent).includes("mock-local-model"), true);

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.browser;
  delete globalThis.fetch;
});

test("fetchAvailableModels handles both OpenAI data[] and Ollama models[] schemas", async () => {
  globalThis.browser = {
    storage: { local: { get: async () => ({ baseUrl: "http://127.0.0.1:1234" }) } }
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ models: [{ name: "qwen3:8b" }] })
  });

  const models = await fetchAvailableModels();
  assert.deepEqual(models, ["qwen3:8b"]);

  delete globalThis.browser;
  delete globalThis.fetch;
});