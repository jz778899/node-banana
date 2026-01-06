# Build and start the app inside an official Node container
Write-Host "Running npm install, build, and start inside Node container..."

docker run --rm -it -p 3000:3000 -v "${PWD}:/app" -w /app node:18-alpine sh -c "npm install --no-audit --no-fund && npm run build && npm run start"
