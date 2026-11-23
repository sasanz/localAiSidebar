const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "json", "xml", "yaml", "yml",
  "js", "ts", "jsx", "tsx", "py", "cs", "cpp", "c", "h", "java",
  "html", "css", "sql", "sh", "ps1", "log", "ini", "toml"
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

function getExtension(filename) {
  const parts = String(filename || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function classifyFile(file) {
  const ext = getExtension(file?.name);
  const type = String(file?.type || "").toLowerCase();
  if (type.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) return "image";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "docx" || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (type.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) return "text";
  return "unsupported";
}

function extractTextFromDocxXml(xmlString) {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(xmlString, "application/xml");
    const paragraphs = Array.from(doc.getElementsByTagName("w:p"));
    return paragraphs
      .map((p) => Array.from(p.getElementsByTagName("w:t")).map((t) => t.textContent).join(""))
      .filter((line) => line.trim().length > 0)
      .join("\n");
  }
  return String(xmlString)
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function parseAttachment(file) {
  const kind = classifyFile(file);
  if (kind === "unsupported") {
    throw new Error(`Unsupported file type: ${file.name}`);
  }

  if (kind === "image") {
    const dataUrl = await readAsDataURL(file);
    return { name: file.name, kind: "image", dataUrl };
  }

  if (kind === "text") {
    const text = await file.text();
    return { name: file.name, kind: "text", text };
  }

  if (kind === "docx") {
    if (typeof JSZip === "undefined") throw new Error("JSZip library not loaded.");
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) throw new Error(`Invalid DOCX archive: ${file.name}`);
    const xml = await docXmlFile.async("string");
    const text = extractTextFromDocxXml(xml);
    return { name: file.name, kind: "docx", text };
  }

  if (kind === "pdf") {
    if (typeof pdfjsLib === "undefined") throw new Error("PDF.js library not loaded.");
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";
    }
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(" ");
      pages.push(`[Page ${p}]\n${pageText}`);
    }
    return { name: file.name, kind: "pdf", text: pages.join("\n\n") };
  }
}

function buildUserMessagePayload(userText, attachments = []) {
  const docItems = attachments.filter((a) => a.kind !== "image" && a.text);
  const imgItems = attachments.filter((a) => a.kind === "image" && a.dataUrl);

  let combinedText = String(userText || "").trim();
  if (docItems.length > 0) {
    const docBlocks = docItems
      .map((d) => `--- ATTACHED FILE: ${d.name} (${d.kind.toUpperCase()}) ---\n${d.text}`)
      .join("\n\n");
    combinedText = combinedText ? `${combinedText}\n\n${docBlocks}` : docBlocks;
  }

  if (imgItems.length === 0) {
    return { role: "user", content: combinedText };
  }

  const contentParts = [];
  if (combinedText) {
    contentParts.push({ type: "text", text: combinedText });
  }
  for (const img of imgItems) {
    contentParts.push({
      type: "image_url",
      image_url: { url: img.dataUrl }
    });
  }
  return { role: "user", content: contentParts };
}

if (typeof globalThis !== "undefined") {
  globalThis.FileParser = {
    classifyFile,
    extractTextFromDocxXml,
    parseAttachment,
    buildUserMessagePayload
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    classifyFile,
    extractTextFromDocxXml,
    parseAttachment,
    buildUserMessagePayload
  };
}
