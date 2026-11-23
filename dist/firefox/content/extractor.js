// content script for extracting visible text from a page

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "EXTRACT_TEXT") return;

  // Clone the body to avoid mutating the live DOM
  const clonedBody = document.body.cloneNode(true);

  // Tags to remove from the clone
  const tagsToRemove = ["script", "style", "noscript", "nav", "footer", "header", "aside", "iframe", "svg"];
  tagsToRemove.forEach(tag => {
    const elements = clonedBody.querySelectorAll(tag);
    elements.forEach(el => el.remove());
  });

  // Extract and normalize text content
  let rawText = clonedBody.innerText || "";
  const normalizedText = rawText.replace(/\s+/g, " ").trim();

  const result = {
    title: document.title,
    url: window.location.href,
    text: normalizedText,
  };

  sendResponse(result);
  // Return true to indicate async response
  return true;
});