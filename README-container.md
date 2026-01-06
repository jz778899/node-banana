Usage: run the provided PowerShell helpers from the project root (requires Docker Desktop)

Install dependencies inside a container:

```powershell
./container-npm-install.ps1
```

Build and start inside a container:

```powershell
./container-build-start.ps1
```

Direct docker command (PowerShell):

```powershell
docker run --rm -it -p 3000:3000 -v "${PWD}:/app" -w /app node:18-alpine sh -c "npm install --no-audit --no-fund && npm run build && npm run start"
```

Local alternative (if you have Node.js installed):

```powershell
npm install
npm run build
npm run start
```
