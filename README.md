# SyncZone — Working Real-Time Watch Party

## What's fixed
- ❌ No more fake Sara/Ravi auto-joining
- ✅ Real Firebase backend — rooms actually work across devices
- ✅ Someone on another phone can join with the room code
- ✅ Video URL syncs for everyone when host loads it
- ✅ Chat is real-time across all devices
- ✅ Members list updates live as people join/leave

---

## Setup (one-time, ~5 minutes)

### Step 1 — Create Firebase project (free)
1. Go to https://console.firebase.google.com
2. Click **Add project** → name it `synczone` → Continue
3. Disable Google Analytics (not needed) → Create project

### Step 2 — Get your config
1. On the project page, click the **Web** icon `</>`
2. Register app → name it `synczone-web`
3. Copy the `firebaseConfig` object that appears

### Step 3 — Enable Realtime Database
1. In the left sidebar: **Build → Realtime Database**
2. Click **Create Database**
3. Choose a location (any)
4. Select **Start in test mode** → Enable

### Step 4 — Set database rules (open for now)
In Realtime Database → Rules, paste this and publish:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

### Step 5 — Fill in config.js
Open `config.js` and replace all the `REPLACE_WITH_YOUR_*` values with your actual Firebase config.

---

## Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# From the synczone folder
cd synczone
vercel
```

Or drag-drop the folder at vercel.com.

---

## How to share with friends
1. You open the site → enter your name → Create Room
2. You get a code like `SYNC-4821`
3. Share that code (or the invite link) only with friends you want
4. They open the site → enter their name → Join Room → paste the code
5. They appear in your waiting room instantly
6. You hit "Start Party" → everyone enters together

---

## Project files
```
synczone/
├── index.html     ← HTML + CSS
├── app.js         ← all JavaScript logic
├── config.js      ← Firebase config (YOU EDIT THIS)
├── sw.js          ← service worker (PWA offline)
├── manifest.json  ← PWA manifest
├── vercel.json    ← Vercel headers + rewrites
└── icons/         ← add PWA icons here
```
