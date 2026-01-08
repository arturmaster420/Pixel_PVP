# Be_Try Arena BR v0.1 (Windows quick start)

## 1) Open terminal in this folder

### Option A (recommended): CMD
1. Open this folder in Explorer.
2. Click the address bar, type `cmd`, press Enter.

### Option B: PowerShell
PowerShell may block `npm` scripts. Use **CMD** or run `npm.cmd` instead of `npm`.

## 2) Install
In CMD (inside this folder):

```bat
npm install
```

## 3) Run (server + client)

```bat
npm run dev
```

You should see:
- Server: ws://localhost:8080
- Vite: http://localhost:5173

## 4) Test PvP
Open http://localhost:5173 in your browser.
Open a second tab with the same URL to simulate 2 players.

## If Join doesn't work (port 8080 is already in use)
If the server window shows `listen EADDRINUSE ... :8080`, the WebSocket server did NOT start.
The client may still open, but the **Join** button won't work because it is connecting to an old server or no server.

Fix:
1) Close the old terminal window where you previously ran `npm run dev` (press **Ctrl+C** in that window).
2) Run `npm run dev` again in this project.

Alternative (kill the process using port 8080):

```bat
netstat -ano | findstr :8080
taskkill /PID <PID_FROM_NETSTAT> /F
```

## If PowerShell says scripts are disabled
Either:
- Use CMD, OR
- In PowerShell run commands as:

```powershell
npm.cmd install
npm.cmd run dev
```
