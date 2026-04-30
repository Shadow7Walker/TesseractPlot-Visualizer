# Build script for Tesseract Studio Launcher
# This script bundles the FastAPI server and static assets into a single .exe

Write-Host "Cleaning previous builds..." -ForegroundColor Cyan
if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }
if (Test-Path "build") { Remove-Item -Recurse -Force "build" }

Write-Host "Building TesseractStudio.exe..." -ForegroundColor Yellow

# Run PyInstaller via uv
# --onefile: Bundle into a single executable
# --name: Resulting file name
# --add-data: Include static files and assets (format: source;destination)
# --collect-all: Ensure all parts of fastapi and uvicorn are bundled
# --hidden-import: Explicitly include some common hidden dependencies if needed

uv run pyinstaller `
    --onefile `
    --name "TesseractStudio" `
    --add-data "static;static" `
    --add-data "logo.png;." `
    --collect-all "fastapi" `
    --collect-all "uvicorn" `
    --hidden-import "uvicorn.logging" `
    --hidden-import "uvicorn.loops" `
    --hidden-import "uvicorn.loops.auto" `
    --hidden-import "uvicorn.protocols" `
    --hidden-import "uvicorn.protocols.http" `
    --hidden-import "uvicorn.protocols.http.auto" `
    --hidden-import "uvicorn.protocols.websockets" `
    --hidden-import "uvicorn.protocols.websockets.auto" `
    --hidden-import "uvicorn.lifespan" `
    --hidden-import "uvicorn.lifespan.on" `
    launcher.py

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nBuild successful! Moving executable to current directory..." -ForegroundColor Green
    if (Test-Path "TesseractStudio.exe") { Remove-Item "TesseractStudio.exe" }
    Move-Item "dist/TesseractStudio.exe" "."
    Write-Host "Launcher available at: $(Get-Location)\TesseractStudio.exe" -ForegroundColor Cyan
} else {
    Write-Host "`nBuild failed." -ForegroundColor Red
}
