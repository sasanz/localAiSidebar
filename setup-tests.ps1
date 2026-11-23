# setup-tests.ps1
# Run from inside C:\Users\sasan\Documents\Project\localAiSidebar

$ErrorActionPreference = "Stop"
$Model = "lmstudio/google/gemma-4-12b" # Fast non-reasoning model; or use "lmstudio/gpt-oss-20b"

Write-Host "1. Installing Playwright dev dependency..." -ForegroundColor Cyan
if (-not (Test-Path ".\package.json")) {
    npm init -y | Out-Null
}
npm install -D @playwright/test
npx playwright install chromium

New-Item -ItemType Directory -Force -Path ".\tests" | Out-Null

Write-Host "`n2. Making sidebar/sidebar.js Node-importable for unit tests..." -ForegroundColor Cyan
opencode run -m $Model 'Read sidebar/sidebar.js and update it using the Write tool so that: 1) All DOM queries and addEventListener calls are wrapped inside if (typeof document !== "undefined") { ... } so importing sidebar.js in Node.js does not throw ReferenceError. 2) At the very bottom of sidebar/sidebar.js, add: if (typeof module !== "undefined") { module.exports = { renderMarkdown, escapeHtml }; }'

Write-Host "`n3. Creating unit tests (tests/unit.test.js)..." -ForegroundColor Cyan
opencode run -m $Model 'Create tests/unit.test.js using the Write tool using Node built-in node:test and node:assert/strict that imports { renderMarkdown, escapeHtml } from "../sidebar/sidebar.js" and tests: 1) escapeHtml escapes <, >, and &. 2) renderMarkdown converts Markdown pipe tables into <table><thead><tr><th>... and <tbody><tr><td>... HTML. 3) renderMarkdown converts fenced code blocks into <pre><code>... without executing inner HTML. 4) renderMarkdown converts **bold** and <br> inside table cells properly.'

Write-Host "`n4. Creating Playwright functional E2E test (tests/sidebar.spec.js)..." -ForegroundColor Cyan
opencode run -m $Model 'Create tests/sidebar.spec.js using the Write tool with @playwright/test that: 1) Launches chromium.launchPersistentContext with --disable-extensions-except and --load-extension pointing to path.resolve(__dirname, ".."). 2) Gets the extension ID from context.serviceWorkers() (or waitForEvent("serviceworker")). 3) Intercepts **/v1/models via context.route to return { data: [{ id: "mock-local-model" }] }, and intercepts **/v1/chat/completions to stream SSE events: reasoning_content ("Thinking..."), content ("| ColA | ColB |\n|---|---|\n| Val1 | Val2 |"), and [DONE]. 4) Opens chrome-extension://${extensionId}/sidebar/sidebar.html, verifies #model-select contains "mock-local-model", clicks the first .prompt-chip, verifies .message.user has "Summarize this page", verifies .message.assistant table renders th ["ColA", "ColB"] and td ["Val1", "Val2"], clicks #new-chat-btn, and verifies #welcome-state is visible again.'

Write-Host "`n5. Updating AGENTS.md so OpenCode runs tests automatically after edits..." -ForegroundColor Cyan
opencode run -m $Model 'Read AGENTS.md (or create it if missing) and add a rule using the Write tool instructing the agent: "After modifying any extension JS, HTML, or CSS file, run `node --test tests/unit.test.js` and `npx playwright test` to verify all unit and functional tests pass before completing the task."'

Write-Host "`n6. Running unit and functional test suites now..." -ForegroundColor Green
node --test tests/unit.test.js
npx playwright test