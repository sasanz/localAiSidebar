const test = require("node:test");
const assert = require("node:assert/strict");
const { renderMarkdown, escapeHtml } = require("../sidebar/sidebar.js");
const { classifyFile, extractTextFromDocxXml, buildUserMessagePayload } = require("../sidebar/file-parser.js");

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

  const imgMsg = buildUserMessagePayload("Describe", [{ name: "pic.png", kind: "image", dataUrl: "data:image/png;base64,AAA" }]);
  assert.equal(Array.isArray(imgMsg.content), true);
  assert.equal(imgMsg.content[0].type, "text");
  assert.equal(imgMsg.content[1].type, "image_url");
  assert.equal(imgMsg.content[1].image_url.url, "data:image/png;base64,AAA");
});
