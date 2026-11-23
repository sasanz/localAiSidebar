# Project Rules: Local AI Sidebar (Cross-Browser MV3)

## Stack & Architecture
- **100% Zero-Build Vanilla JavaScript (ES2022), HTML5, and CSS3.** Do NOT initialize npm, package.json, Vite, Webpack, TypeScript, or React.
- **Target Browsers:** Chrome, Edge, and Firefox (Manifest V3).

## OpenCode & Reasoning Execution Rules
- **Use File Tools Directly:** Write or edit the target files on disk using your file tools. Do not dump large code blocks into chat unless asked.
- **Stay Focused & Concise:** Keep internal reasoning brief and focused on interface contracts (IDs, message types, and permissions). Modify ONLY the files requested in the current prompt, then summarize what you wrote in 2–3 bullet points.
- **Complete Files Only:** Never write `// ... existing code ...` or `// TODO` stubs. Every file must be 100% runnable.

## Hard Technical Constraints
1. **Strict MV3 CSP:** Never use `eval()`, `new Function()`, inline `<script>` tags, or inline HTML event attributes (`onclick="..."`). Bind all events in external `.js` files via `addEventListener`.
2. **XSS Safety:** Never inject unescaped LLM responses or webpage text into `innerHTML`. Escape HTML entities first or build DOM nodes with `textContent`.
3. **CORS Bypass:** Never call `http://localhost:*` or `http://127.0.0.1:*` from `sidebar.js` or `extractor.js`. All `fetch()` calls to LM Studio or Ollama MUST live in `background/service-worker.js`.
4. **Cross-Browser Manifest:** Support both Chromium (`side_panel`, `background.service_worker`) and Firefox (`sidebar_action`, `background.scripts`).

## Tool Rule
- Prefer the `Write` tool (writing the complete updated file) over `Edit` when modifying files, so whitespace mismatches never cause failed edits. If a file already satisfies the prompt's requirements, make no changes and exit cleanly.