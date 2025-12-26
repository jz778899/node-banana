# Run `npm install` inside an official Node container
Write-Host "Attempting to run npm install inside Node container..."

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
	Write-Host "Docker not found on this machine. Install Docker Desktop or run 'npm install' locally." -ForegroundColor Yellow
	exit 1
}

docker run --rm -v "${PWD}:/app" -w /app node:18-alpine sh -c "npm install --no-audit --no-fund"
