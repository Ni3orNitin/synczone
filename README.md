# SyncZone — Private Watch Party PWA

Watch YouTube & play games with your crew. Only invited friends can join.

## Project structure

```
synczone/
├── index.html       ← main app (PWA, responsive, all features)
├── manifest.json    ← PWA manifest
├── sw.js            ← service worker (offline caching)
├── vercel.json      ← Vercel config
├── gen-icons.js     ← icon generator (optional)
└── icons/           ← create this folder with your icons
```

---

## Deploy to Vercel (3 steps)

### Option A — Vercel CLI (fastest)

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Go into the folder
cd synczone

# 3. Deploy
vercel
```

Follow the prompts. Your site will be live at `https://synczone-xxx.vercel.app`.

---

### Option B — Vercel Dashboard (no CLI)

1. Go to **https://vercel.com** → Sign in with GitHub
2. Click **Add New → Project**
3. Drag and drop the `synczone/` folder onto the upload area  
   *(or push it to a GitHub repo and import that)*
4. Leave all settings as default → click **Deploy**
5. Done ✓ — get your live URL

---

## Generate PWA icons

Icons are needed for "Add to Home Screen" on mobile.

```bash
# Install canvas (only needed once)
npm install canvas

# Run the generator
node gen-icons.js
```

This creates `icons/icon-72.png` through `icons/icon-512.png`.

Alternatively, use https://www.pwabuilder.com/imageGenerator — upload any
512×512 image and it will generate all sizes for you.

---

## PWA features

| Feature | Status |
|---|---|
| Installable (Add to Home Screen) | ✓ |
| Offline shell caching | ✓ |
| Standalone fullscreen mode | ✓ |
| Mobile responsive layout | ✓ |
| iOS safe area support | ✓ |
| Collapsible chat (desktop) | ✓ |
| Chat drawer (mobile) | ✓ |
| Bottom nav (mobile) | ✓ |

---

## Features

- **Invite-only rooms** — 4-step flow: name → create/join → invite friends → waiting room
- **Video call** always visible (side panel desktop / strip mobile)
- **Watch Party** — paste any YouTube URL, everyone syncs
- **Party Chat** — collapsible on desktop, slide-up drawer on mobile
- **Games** — Tic-Tac-Toe, Hangman, Chess (full legal moves)
