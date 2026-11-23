const { test, expect, chromium } = require("@playwright/test");
const http = require("node:http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const EXTENSION_PATH = path.resolve(__dirname, "..");

function startMockServers() {
  return new Promise((resolve) => {
    const capturedRequests = [];
    let slowStreamMode = false;

    const aiServer = http.createServer((req, res) => {
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
        res.end(JSON.stringify({ data: [{ id: "qwen3-30b-mock" }, { id: "gemma-4-mock" }] }));
        return;
      }

      if (req.url.endsWith("/chat/completions")) {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk; });
        req.on("end", () => {
          try { capturedRequests.push(JSON.parse(raw)); } catch {}
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          });

          if (slowStreamMode) {
            res.write('data: {"choices":[{"delta":{"content":"Partial output before stop..."}}]}\n\n');
            const timer = setInterval(() => {
              if (res.writableEnded) {
                clearInterval(timer);
                return;
              }
              res.write('data: {"choices":[{"delta":{"content":" more"}}]}\n\n');
            }, 150);
            req.on("close", () => clearInterval(timer));
            return;
          }

          res.write('data: {"choices":[{"delta":{"reasoning_content":"Analyzing context..."}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":"| Metric | Value |\\n|---|---|\\n| Status | Verified |"}}]}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    const webServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><head><title>Shadow Villas HOA Notice</title></head>
        <body><h1>Annual Roof Inspection</h1><p>Inspection begins Monday at 9:00 AM for all 18 units.</p></body></html>`);
    });

    aiServer.listen(0, "127.0.0.1", () => {
      const aiPort = aiServer.address().port;
      webServer.listen(0, "127.0.0.1", () => {
        const webPort = webServer.address().port;
        resolve({
          aiBaseUrl: `http://127.0.0.1:${aiPort}/v1`,
          webUrl: `http://127.0.0.1:${webPort}/notice`,
          capturedRequests,
          setSlowStream: (val) => { slowStreamMode = val; },
          close: () => {
            aiServer.close();
            webServer.close();
          }
        });
      });
    });
  });
}

test.describe("Local AI Sidebar Full Functional Suite", () => {
  test("Covers Options persistence, active tab context toggle, multimodal attachments, streaming tables, multi-turn history, stop abort, and offline errors", async () => {
    const env = await startMockServers();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-ai-func-"));

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`
      ]
    });

    try {
      let [sw] = context.serviceWorkers();
      if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
      const extId = sw.url().split("/")[2];

      // 1. OPTIONS PAGE: Save custom settings, verify persistence, test reset
      const optionsPage = await context.newPage();
      await optionsPage.goto(`chrome-extension://${extId}/options/options.html`);

      await optionsPage.selectOption("#provider", "ollama");
      await optionsPage.fill("#baseUrl", env.aiBaseUrl);
      await optionsPage.fill("#maxContextChars", "5000");
      await optionsPage.fill("#systemPrompt", "Custom test system prompt.");
      await optionsPage.click("#refresh-models-btn");
      await expect(optionsPage.locator("#model")).toContainText("qwen3-30b-mock");

      await optionsPage.click('button[type="submit"]');
      await expect(optionsPage.locator("#status-msg")).not.toBeEmpty();

      await optionsPage.reload();
      await expect(optionsPage.locator("#baseUrl")).toHaveValue(env.aiBaseUrl);
      await expect(optionsPage.locator("#maxContextChars")).toHaveValue("5000");
      await expect(optionsPage.locator("#systemPrompt")).toHaveValue("Custom test system prompt.");
      await optionsPage.close();

      // 2. ACTIVE WEBPAGE CONTEXT: Open live HTTP webpage, then open sidebar
      const contentTab = await context.newPage();
      await contentTab.goto(env.webUrl);
      await expect(contentTab.locator("h1")).toHaveText("Annual Roof Inspection");

      const sidebar = await context.newPage();
      await sidebar.goto(`chrome-extension://${extId}/sidebar/sidebar.html`);
      await expect(sidebar.locator("#model-select")).toContainText("qwen3-30b-mock");
      await sidebar.selectOption("#model-select", "gemma-4-mock");

      // Refresh page context while contentTab is active
      await contentTab.bringToFront();
      await sidebar.locator("#refresh-page-btn").click();
      await expect(sidebar.locator("#page-status")).toContainText("Shadow Villas HOA Notice");

      // 3. PROMPT CHIP + SSE STREAMING TABLE + PAGE CONTEXT INCLUDED
      await sidebar.locator(".prompt-chip").first().click();
      await expect(sidebar.locator("#chat-messages table")).toBeVisible();
      await expect(sidebar.locator("#chat-messages td").last()).toHaveText("Verified");

      const firstReq = env.capturedRequests.at(-1);
      expect(firstReq.model).toBe("gemma-4-mock");
      expect(firstReq.messages[0].content).toContain("Shadow Villas HOA Notice");
      expect(firstReq.messages[0].content).toContain("Annual Roof Inspection");

      // 4. UNCHECK PAGE CONTEXT TOGGLE + MULTI-TURN CONVERSATION HISTORY
      await sidebar.locator("#include-page-toggle").uncheck();
      await sidebar.fill("#user-input", "Follow up without page context");
      await sidebar.click("#send-btn");
      await expect(sidebar.locator("#chat-messages .message")).toHaveCount(4); // 2 user + 2 assistant

      const secondReq = env.capturedRequests.at(-1);
      expect(secondReq.messages[0].content).not.toContain("Annual Roof Inspection");
      expect(secondReq.messages.length).toBeGreaterThanOrEqual(4);

      // 5. NEW CHAT RESET (#new-chat-btn)
      await sidebar.click("#new-chat-btn");
      await expect(sidebar.locator("#chat-messages .message")).toHaveCount(0);
      await expect(sidebar.locator("#welcome-state")).toBeVisible();

      // 6. MULTIMODAL ATTACHMENTS (Text + PNG Image)
      const tinyPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      );
      await sidebar.setInputFiles("#file-input", [
        { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Attached spec notes") },
        { name: "diagram.png", mimeType: "image/png", buffer: tinyPng }
      ]);
      await expect(sidebar.locator("#attachment-list")).toBeVisible();
      await expect(sidebar.locator("#attachment-list")).toContainText("notes.txt");
      await expect(sidebar.locator("#attachment-list")).toContainText("diagram.png");

      await sidebar.fill("#user-input", "Inspect attached files");
      await sidebar.click("#send-btn");
      await expect(sidebar.locator("#chat-messages table")).toBeVisible();

      const attachmentReq = env.capturedRequests.at(-1);
      const lastUserMsg = attachmentReq.messages.at(-1);
      expect(Array.isArray(lastUserMsg.content)).toBe(true);
      expect(lastUserMsg.content[0].text).toContain("Attached spec notes");
      expect(lastUserMsg.content[1].type).toBe("image_url");

      // 7. MID-STREAM ABORT (#stop-btn)
      env.setSlowStream(true);
      await sidebar.fill("#user-input", "Stream slowly");
      await sidebar.click("#send-btn");
      await expect(sidebar.locator("#stop-btn")).toBeVisible();
      await expect(sidebar.locator("#chat-messages")).toContainText("Partial output before stop...");
      await sidebar.click("#stop-btn");
      await expect(sidebar.locator("#send-btn")).toBeVisible();
      env.setSlowStream(false);

      // 8. OFFLINE SERVER ERROR RECOVERY
      await sidebar.evaluate(async () => {
        await chrome.storage.local.set({ baseUrl: "http://127.0.0.1:1/v1" });
      });
      await sidebar.fill("#user-input", "Test offline handling");
      await sidebar.click("#send-btn");
      await expect(sidebar.locator("#chat-messages .message").last()).toContainText(/error|failed|fetch/i);
    } finally {
      await context.close();
      env.close();
    }
  });
});