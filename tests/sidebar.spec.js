const { test, expect, chromium } = require("@playwright/test");
const http = require("node:http");
const path = require("path");

const EXTENSION_PATH = path.resolve(__dirname, "..");

function startMockAiServer() {
  return new Promise((resolve) => {
    let lastCapturedBody = null;
    const server = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-local-model" }] }));
        return;
      }

      if (req.url.endsWith("/chat/completions")) {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk; });
        req.on("end", () => {
          try { lastCapturedBody = JSON.parse(raw); } catch {}
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          });
          res.write('data: {"choices":[{"delta":{"reasoning_content":"Thinking..."}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":"| ColA | ColB |\\n|---|---|\\n| Val1 | Val2 |"}}]}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        getLastBody: () => lastCapturedBody
      });
    });
  });
}

test("Sidebar loads models, attaches files, streams SSE table, and resets chat", async () => {
  const { server, baseUrl, getLastBody } = await startMockAiServer();

  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const extensionId = sw.url().split("/")[2];

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar/sidebar.html`);

    await page.evaluate(async (url) => {
      await chrome.storage.local.set({ baseUrl: url, model: "" });
    }, baseUrl);
    await page.reload();

    await expect(page.locator("#model-select")).toContainText("mock-local-model");

    // Test attaching a text file via #file-input
    await page.setInputFiles("#file-input", {
      name: "specs.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Project v2 local file test")
    });
    await expect(page.locator(".attachment-pill")).toContainText("specs.txt");

    await page.fill("#user-input", "Check attachment");
    await page.click("#send-btn");

    await expect(page.locator(".message.user")).toContainText("specs.txt");
    await expect(page.locator(".message.assistant table th")).toHaveText(["ColA", "ColB"]);
    await expect(page.locator(".message.assistant table td")).toHaveText(["Val1", "Val2"]);

    // Verify the attached file content actually reached the AI backend payload
    const sentMessages = getLastBody()?.messages || [];
    const lastUserMsg = sentMessages[sentMessages.length - 1];
    expect(lastUserMsg.content).toContain("Project v2 local file test");

    await page.click("#new-chat-btn");
    await expect(page.locator("#welcome-state")).toBeVisible();
  } finally {
    await context.close();
    server.close();
  }
});
