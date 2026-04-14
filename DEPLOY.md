# Deploying Mistraker on Render (Free Tier)

## Prerequisites

- A [Render](https://render.com) account (sign up with GitHub)
- Your code pushed to a GitHub repository

## Step 1 — Push to GitHub

If you haven't already:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/mistraker.git
git push -u origin main
```

## Step 2 — Create the Web Service on Render

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New** → **Web Service**
3. Connect your GitHub repo (authorize Render if needed)
4. Fill in:

| Field | Value |
|---|---|
| **Name** | `mistraker` |
| **Runtime** | Python |
| **Build Command** | `pip install flask gunicorn` |
| **Start Command** | `gunicorn main:app --bind 0.0.0.0:$PORT` |
| **Plan** | Free |

5. Click **Create Web Service**

Render will detect the Python version from `.python-version`, install dependencies, and start the app.

## Step 3 — Wait for Deploy

Render takes 2-5 minutes on first deploy. Watch the logs — you should see:

```
gunicorn main:app --bind 0.0.0.0:10000
```

Once live, your app URL will be: `https://mistraker.onrender.com`

## Step 4 — That's it!

Your app is live. The SQLite database and images directory are auto-created on first request.

---

## Important Limitations (Free Tier)

- **Data is ephemeral** — Render free tier does NOT have persistent storage. Your `data/mistraker.db` and uploaded images will be **wiped on every deploy or restart**. This is fine for a demo, not for production.
- **App sleeps** — After 15 min of inactivity, the app spins down. First request takes ~30s to wake up.
- **750 hours/month** — Enough to run 24/7 for one service.

## Making Data Persistent (Paid Tier — $7/mo)

If you want data to survive restarts:

1. Add a **Persistent Disk** in Render dashboard:
   - **Mount path**: `/opt/render/project/data`
   - **Size**: 1 GB ($7/mo)
2. Set the environment variable `DATA_DIR` to `/opt/render/project/data` (you'd need to add this support to `models.py`)
3. This ensures your SQLite DB and images survive deploys

## Alternative: Render Blueprint

The `render.yaml` file in this repo lets you deploy with one click:

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New** → **Blueprint**
3. Select your repo
4. Render reads `render.yaml` and configures everything automatically