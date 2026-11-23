# setup-and-run.ps1
$Model = "lmstudio/gpt-oss-20b"  # Verify with `opencode models`

Write-Host "Starting script in: $(Get-Location)" -ForegroundColor Yellow

# 1. Create jobs folder
New-Item -ItemType Directory -Force -Path ".\jobs" | Out-Null

Set-Content -Path ".\jobs\03-gemini-html.txt" -Encoding UTF8 -Value 'Rewrite ONLY sidebar/sidebar.html (zero inline JS, keep all existing element IDs intact: #model-select, #new-chat-btn, #options-btn, #include-page-toggle, #page-status, #refresh-page-btn, #chat-messages, .prompt-chip, #user-input, #send-btn, #stop-btn, #attach-btn): Top bar with title "Gemini Local", <select id="model-select">, and SVG icon buttons #new-chat-btn and #options-btn; Context pill bar with <input type="checkbox" id="include-page-toggle">, <span id="page-status">, and SVG icon button #refresh-page-btn; Main area #chat-messages with #welcome-state ("Hi, how can I help?" + 3 .prompt-chip pills: "Summarize this page", "Key takeaways", "Explain simply"); Bottom bar unified rounded box holding <textarea id="user-input" rows="1"> on top and SVG icon buttons #attach-btn (left) and #send-btn + #stop-btn (right) below.'

Set-Content -Path ".\jobs\04-gemini-css.txt" -Encoding UTF8 -Value 'Rewrite ONLY sidebar/sidebar.css as a sleek dark-mode Google Gemini UI: Colors #0e0e10 background, #1e1f20 input/header surfaces, #282a2c user bubbles and prompt chips, #e3e3e3 text, #9aa0a6 muted text, #8ab4f8 accents. Full-height flex column (100vh) where header (50px) and bottom floating composer (border-radius: 22px) stay fixed and #chat-messages scrolls in between. User messages right-aligned in #282a2c rounded pills (max-width: 85%); assistant messages left-aligned full width with clean typography (line-height: 1.6) and dark #17181a <pre><code> blocks.'

Write-Host "Job files written:" -ForegroundColor Green
Get-ChildItem ".\jobs\*.txt" | ForEach-Object { Write-Host " - $($_.Name)" }

# 3. Allow unattended file edits in opencode.json if not already set
if (-not (Test-Path ".\opencode.json")) {
    Set-Content -Path ".\opencode.json" -Encoding UTF8 -Value '{ "$schema": "https://opencode.ai/config.json", "permission": "allow" }'
}

# 4. Run each job sequentially
foreach ($File in (Get-ChildItem ".\jobs\*.txt" | Sort-Object Name)) {
    Write-Host "`n=== Running $($File.Name) ===" -ForegroundColor Cyan
    $Prompt = Get-Content -Path $File.FullName -Raw
    opencode run -m $Model $Prompt
    Write-Host "Finished $($File.Name) with exit code: $LASTEXITCODE" -ForegroundColor Yellow
}