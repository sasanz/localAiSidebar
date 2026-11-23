const { test, expect, chromium, firefox } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const rootDir = path.resolve(__dirname, "..");
const firefoxDir = path.resolve(rootDir, "dist", "firefox");

test("Manifest validation for Chromium/Edge and Firefox builds", () => {
  const chromeManifest = JSON.parse(fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"));
  const ffManifest = JSON.parse(fs.readFileSync(path.join(firefoxDir, "manifest.json"), "utf8"));

  expect(chromeManifest.background.service_worker).toBe("background/service-worker.js");
  expect(chromeManifest.background.scripts).toBeUndefined();
  expect(chromeManifest.side_panel.default_path).toBe("sidebar/sidebar.html");

  expect(ffManifest.background.scripts).toEqual(["background/service-worker.js"]);
  expect(ffManifest.background.service_worker).toBeUndefined();
  expect(ffManifest.sidebar_action.default_panel).toBe("sidebar/sidebar.html");
});

test("Microsoft Edge loads extension, sets openPanelOnActionClick=true, and renders Local AI sidebar", async () => {
  const userDataDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "edge-ext-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "msedge",
    headless: false,
    args: [
      `--disable-extensions-except=${rootDir}`,
      `--load-extension=${rootDir}`,
    ],
  });

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extId = sw.url().split("/")[2];

    const behavior = await sw.evaluate(async () => {
      return await chrome.sidePanel.getPanelBehavior();
    });
    expect(behavior.openPanelOnActionClick).toBe(true);

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`chrome-extension://${extId}/sidebar/sidebar.html`);
    await expect(page.locator("body")).toContainText("Local AI");
    await expect(page.locator("textarea, input[type='text']").first()).toHaveAttribute("placeholder", /Local AI/i);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("Mozilla Firefox renders Local AI sidebar UI cleanly without runtime errors", async () => {
  const browser = await firefox.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const sidebarUrl = "file:///" + path.join(firefoxDir, "sidebar", "sidebar.html").replace(/\\/g, "/");
    await page.goto(sidebarUrl);
    await expect(page.locator("body")).toContainText("Local AI");
    await expect(page.locator("textarea, input[type='text']").first()).toHaveAttribute("placeholder", /Local AI/i);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});