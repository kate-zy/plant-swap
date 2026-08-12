# Plant Swap

A tiny website for sharing plants, cuttings, and green stuff you have available
to swap or give away. **No dependencies to install** — it runs with plain
Node.js.

## What it does (v1)

- A public page (`/`) listing everything you currently have available, with
  photo, form (fresh prop / bare root / in soil), quantity, and notes —
  filterable, with a grid or list view.
- Visitors can hit **"Claim this"** on an individual listing and submit their
  name, contact info, and how many they want — other people can still claim
  the rest of that same listing if there's quantity left.
- An admin page (`/admin.html`, password-protected) where you add new
  listings (with a photo, taken directly from your camera on mobile), see
  every claim with the requester's contact info, confirm a pickup, reject a
  claim, or delete a listing.
- Installable as a home-screen app (PWA) on phone or desktop.
- Real push notifications — you get notified the moment someone claims
  something, even if the browser's closed.

This is intentionally built so it's a short step to v2 (other people posting
their own plants too) — the data model, claim flow, and admin/public split
are already there; v2 mainly needs per-user accounts instead of one shared
admin login.

## Running it locally

Requires [Node.js](https://nodejs.org) (v18+). No `npm install` needed — it
only uses Node's built-in modules.

```
node server.js
```

Then open:
- **http://localhost:3000** — the public listing page
- **http://localhost:3000/admin.html** — the admin page (default login below)

By default the admin login is `admin` / `plants123` — **change this** before
sharing the site with anyone (see Configuration below).

## Configuration

Settings are read from environment variables first, then from an optional
`config.json` file (handy for local dev), then built-in defaults.

| Setting | Env var | config.json key | Default |
|---|---|---|---|
| Port | `PORT` | `port` | `3000` |
| Admin username | `ADMIN_USER` | `adminUser` | `admin` |
| Admin password | `ADMIN_PASSWORD` | `adminPassword` | `plants123` |
| Site name | `SITE_NAME` | `siteName` | `Plant Swap` |
| Push contact | `VAPID_SUBJECT` | `vapidSubject` | `mailto:admin@example.com` |
| Data storage location | `DATA_DIR` | — | `./data` |

For local dev, copy `config.example.json` to `config.json` and edit it —
`config.json` is gitignored, so your real password never gets committed. In
production (see below), set these as environment variables on your host
instead — nothing secret needs to live in the repo at all.

## Your data

Listings, uploaded photos, and push-notification keys all live under
`DATA_DIR` (`./data` locally): `data/plants.json`, `data/uploads/`,
`data/vapid-keys.json`, `data/push-subscriptions.json`. Back up that one
folder and you have everything.

## Putting it online (Render)

This app is a single always-on process that writes to local disk, so it
needs a host with **persistent storage** — not a serverless platform like
Vercel, which wipes local files between requests. [Render](https://render.com)
is a good fit: cheap, automatic HTTPS (required for push notifications to
work on a real domain), and it auto-deploys whenever you push to GitHub —
the same workflow as Vercel, just for a persistent app instead of a
serverless one.

**1. Get the code onto GitHub**

```
cd plant-swap
git init
git add .
git commit -m "Initial commit"
```

Create a new empty repository on [github.com/new](https://github.com/new)
(no README/license — you already have files), then:

```
git remote add origin https://github.com/<your-username>/plant-swap.git
git branch -M main
git push -u origin main
```

**2. Create the Render service**

1. Sign up / log in at [render.com](https://render.com) and connect your
   GitHub account.
2. **New +** → **Web Service** → pick your `plant-swap` repo.
3. Environment: **Node**. Build command: `npm install` (there's nothing to
   install, but Render expects this step). Start command: `node server.js`.
4. Plan: choose **Starter** (~$7/mo) — the free tier spins down when idle
   and has no persistent disk, which would wipe your listings and photos on
   every restart.

**3. Add a persistent disk**

In the service's **Disks** tab, add a disk (1 GB is plenty to start — about
$0.25/mo), mount path `/var/data`.

**4. Set environment variables**

In the **Environment** tab, add:

| Key | Value |
|---|---|
| `DATA_DIR` | `/var/data` |
| `ADMIN_PASSWORD` | *pick something only you know* |
| `SITE_NAME` | `Zy's Plant Swap` (or whatever you'd like) |
| `VAPID_SUBJECT` | `mailto:you@example.com` |

(`PORT` is set automatically by Render — no need to add it.)

**5. Deploy**

Render builds and deploys automatically. You'll get a URL like
`https://plant-swap.onrender.com` — that's your real, shareable, HTTPS link.
From now on, every `git push` to `main` auto-deploys the update.

Once it's live, open the admin page there and click **Enable push
notifications** — this only works over a real HTTPS URL (or `localhost`),
not over plain `http://`, so this is the point where push notifications
start working for real.

### Alternative hosts

Railway works the same way (GitHub-connected, persistent volumes, similar
setup) but is usage-based rather than flat-priced, so cost is a bit less
predictable — worth a look if you want to compare. Fly.io is often the
cheapest option but needs its own CLI and a bit more setup rather than a
pure web dashboard.

## File structure

```
plant-swap/
  server.js            the whole backend (routing, API, auth, push) — zero dependencies
  config.example.json  template for local config — copy to config.json (gitignored)
  package.json
  .gitignore
  data/                 your listings, photos, and keys (gitignored, persists on disk)
  public/
    index.html           public page
    admin.html            admin page
    app.js / admin.js     frontend logic
    style.css             shared styling
    sw.js                 service worker (offline shell + push)
    manifest.json          served dynamically by server.js from siteName
    icon-192.png / icon-512.png
```
