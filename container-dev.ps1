# Start the app in dev mode inside an official Node container
Write-Host "Starting dev server inside Node container..."

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Docker not found on this machine. Install Docker Desktop or run 'npm run dev' locally." -ForegroundColor Yellow
    exit 1
}

docker run --rm -it -p 3000:3000 -v "${PWD}:/app" -w /app node:18-alpine sh -c "npm install --no-audit --no-fund && npm run dev"
