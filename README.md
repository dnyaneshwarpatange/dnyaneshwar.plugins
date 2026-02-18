# Atlassian Plugin Compatibility Checker

A Node.js web application for automating Jira & Confluence Data Center upgrade plugin compatibility checks.

---

## ✨ Features

- 🔐 **Login system** with hardcoded credentials (persists sessions via MongoDB)
- ⚡ **Jira & Confluence tabs** — separate plugin lists per product
- 🔌 **Plugin management** — Add, Edit, Delete, Bulk Import plugins (persisted in MongoDB)
- 🕷️ **Puppeteer-based scraper** — scrapes Atlassian Marketplace version history with 5s delays
- 📄 **"Load more" support** — automatically clicks load-more to check all versions
- 📊 **Real-time progress** via Server-Sent Events (SSE)
- 📥 **Colored Excel report** — summary sheet + version details sheet with conditional formatting
- 📦 **Persistent storage** — all plugin data saved in MongoDB (survives logout)

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** v18+ 
- **MongoDB** (local or Atlas)
- **npm** or yarn

### 2. Install dependencies
```bash
cd atlassian-compat-checker
npm install
```
> ⚠️ Puppeteer will download Chromium (~170MB) on first install.

### 3. Configure MongoDB
Default: `mongodb://127.0.0.1:27017/atlassian-compat`

To use a different URI:
```bash
MONGO_URI="mongodb://your-uri" npm start
```

### 4. Start the server
```bash
npm start
# or for development:
npm run dev
```

### 5. Open browser
```
http://localhost:3000
```

---

## 🔑 Login Credentials

| Username | Password | Role |
|----------|----------|------|
| admin | Admin@123 | admin |
| developer | Dev@456 | user |

---

## 📋 How to Use

### Adding Plugins
1. Select **Jira** or **Confluence** tab
2. Click **+ Add Plugin**
3. Enter:
   - **Plugin Name** — e.g. `ScriptRunner for Confluence`
   - **Marketplace URL** — e.g. `https://marketplace.atlassian.com/apps/1215215/scriptrunner-for-confluence/version-history`
   - **Current Version** — e.g. `8.57.0`

### Bulk Import
Format: `Plugin Name | URL | Current Version | Notes (optional)`

Example:
```
ScriptRunner for Confluence | https://marketplace.atlassian.com/apps/1215215/... | 8.57.0 | Core
Comala Document Management | https://marketplace.atlassian.com/apps/... | 7.2.1
```

### Running Compatibility Check
1. Enter **Target DC Version** (e.g. `9.31.0`)
2. Click **Check Compatibility**
3. Watch real-time progress — scraper waits 5s between each plugin
4. Click **Download Excel Report** when done

---

## 📊 Excel Report Structure

### Sheet 1: `Confluence Compatibility` (or Jira)
| Column | Description |
|--------|-------------|
| Plugin Name | Name of the plugin |
| Current Version | Version currently installed |
| Compatible with DC X.X.X? | ✅/❌ status |
| Recommended Version | Latest compatible plugin version |
| Compatible Version Range | Range of plugin versions compatible with target DC |
| DC Compatibility (Recommended) | Full DC compatibility string for recommended version |
| Marketplace URL | Clickable link |

Colors:
- 🟢 **Green rows** — currently installed version is compatible
- 🔴 **Red rows** — current version NOT compatible (upgrade needed)
- 🟡 **Yellow rows** — scraping error

### Sheet 2: Version Details
Lists all compatible plugin versions with their DC compatibility ranges.

---

## 🏗️ Project Structure

```
atlassian-compat-checker/
├── server.js              # Express server, routes, SSE
├── models/
│   └── Plugin.js          # Mongoose plugin schema
├── utils/
│   ├── scraper.js         # Puppeteer scraper + version comparison
│   └── excelGenerator.js  # ExcelJS colored report generator
├── public/
│   └── index.html         # Single-page frontend
└── package.json
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| MONGO_URI | mongodb://127.0.0.1:27017/atlassian-compat | MongoDB connection string |

---

## 🔧 Troubleshooting

**Puppeteer fails to launch:**
```bash
# Install required system libs (Linux)
apt-get install -y libgbm1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6
```

**MongoDB connection error:**
```bash
# Start MongoDB locally
mongod --dbpath /data/db
```

**"No version data found" errors:**
- The Atlassian Marketplace is a JavaScript-heavy SPA. Puppeteer needs a full browser to render it.
- Try increasing the wait timeout in `scraper.js`
- Check the URL format — should include `/version-history`
