# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev-Server Regel
- Starte NIEMALS npm run dev im Hintergrund (&, nohup, start, oder als Background-Prozess)
- Der Next.js Dev-Server wird ausschließlich vom User manuell gestartet
- Claude Code darf npm run dev nur im Vordergrund ausführen wenn der User es explizit verlangt
- Claude Code verwaltet nur den Backend-Server via PM2 (pm2 restart stayos-api)

## Backend Deploy
```bash
ssh -i ~/.ssh/stayos_server root@85.25.46.31 "cd /var/www/stayos-api && git pull && pm2 restart stayos-api"
```
