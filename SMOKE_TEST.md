# Smoke tests (v0.2.0)

## Automated WS smoke

Runs a minimal WebSocket flow test:
- update_required gate
- join public lobby
- bots enable + ready
- receives map/matchStart/snapshots

```bash
npm install
npm run smoke
```

## Manual portal checklist (2–3 minutes)

1. Fresh load (incognito)
   - Press **Start** (portal overlay)
   - Try **Fullscreen**
2. Press **Quick Play**
   - Match starts (with bots if solo)
   - Respawn shows ~5s timer
3. Finish a match
   - Results show
   - Next match works
4. Reconnect
   - Refresh during match, confirm rejoin works
5. Update gate
   - Open an older cached client build -> should show "Update required"
