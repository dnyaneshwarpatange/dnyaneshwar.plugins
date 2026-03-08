const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');
const Plugin = require('./models/Plugin');
const { checkCompatibility } = require('./utils/scraper');
const { generateExcel } = require('./utils/excelGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Hardcoded credentials ───────────────────────────────────────────────────
const USERS = [
  { username: 'admin', password: 'Admin@123', role: 'admin', displayName: 'Administrator' },
  { username: 'developer', password: 'Dev@456', role: 'user', displayName: 'Developer' }
];

// ─── MongoDB Connection ───────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  bufferCommands: false
})
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error('🔧 Check your MONGO_URI in .env file');
    process.exit(1);
  });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'atlassian-compat-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Unauthorized. Please login.' });
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  req.session.user = { username: user.username, role: user.role, displayName: user.displayName };
  res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// ─── Plugin CRUD Routes ───────────────────────────────────────────────────────
// Get all plugins for a type
app.get('/api/plugins/:type', requireAuth, async (req, res) => {
  try {
    const { type } = req.params;
    if (!['jira', 'confluence'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type. Use "jira" or "confluence".' });
    }
    const plugins = await Plugin.find({ type }).sort({ name: 1 });
    res.json(plugins);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a plugin
app.post('/api/plugins', requireAuth, async (req, res) => {
  try {
    const { type, name, marketplaceUrl, currentVersion, notes } = req.body;
    if (!type || !name || !marketplaceUrl || !currentVersion) {
      return res.status(400).json({ error: 'type, name, marketplaceUrl and currentVersion are required.' });
    }
    const plugin = new Plugin({ type, name, marketplaceUrl, currentVersion, notes });
    await plugin.save();
    res.status(201).json(plugin);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a plugin
app.put('/api/plugins/:id', requireAuth, async (req, res) => {
  try {
    const plugin = await Plugin.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!plugin) return res.status(404).json({ error: 'Plugin not found.' });
    res.json(plugin);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a plugin
app.delete('/api/plugins/:id', requireAuth, async (req, res) => {
  try {
    await Plugin.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk import plugins
app.post('/api/plugins/bulk', requireAuth, async (req, res) => {
  try {
    const { plugins } = req.body;
    if (!Array.isArray(plugins) || plugins.length === 0) {
      return res.status(400).json({ error: 'plugins array is required.' });
    }
    const saved = await Plugin.insertMany(plugins);
    res.status(201).json({ success: true, count: saved.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Compatibility Check Route (SSE for progress) ─────────────────────────────
app.get('/api/check-compatibility', requireAuth, async (req, res) => {
  const { type, targetDCVersion, pluginIds } = req.query;

  if (!type || !targetDCVersion) {
    return res.status(400).json({ error: 'type and targetDCVersion are required.' });
  }

  // Set up Server-Sent Events for real-time progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let plugins;
    if (pluginIds) {
      const ids = pluginIds.split(',').filter(Boolean);
      plugins = await Plugin.find({ _id: { $in: ids }, type });
    } else {
      plugins = await Plugin.find({ type });
    }

    if (plugins.length === 0) {
      sendEvent({ type: 'error', message: 'No plugins found for this product type.' });
      res.end();
      return;
    }

    sendEvent({ type: 'start', total: plugins.length, message: `Starting compatibility check for ${plugins.length} plugins...` });

    const progressCallback = (message) => {
      sendEvent({ type: 'progress', message });
    };

    const results = await checkCompatibility(
      plugins.map(p => ({
        name: p.name,
        marketplaceUrl: p.marketplaceUrl,
        currentVersion: p.currentVersion
      })),
      targetDCVersion,
      progressCallback
    );

    sendEvent({ type: 'complete', results });

  } catch (err) {
    sendEvent({ type: 'error', message: err.message });
  }

  res.end();
});

// ─── Excel Download Route ────────────────────────────────────────────────────
app.post('/api/download-excel', requireAuth, async (req, res) => {
  try {
    const { results, type, targetDCVersion } = req.body;
    if (!results || !type || !targetDCVersion) {
      return res.status(400).json({ error: 'results, type, and targetDCVersion are required.' });
    }

    const buffer = await generateExcel(results, type, targetDCVersion);
    const filename = `${type}-compat-dc${targetDCVersion}-${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Serve Frontend ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Atlassian Compatibility Checker`);
  console.log(`   Server running at: http://localhost:${PORT}`);
  console.log(`   MongoDB: ${MONGO_URI}`);
  console.log(`\n   Credentials:`);
  USERS.forEach(u => console.log(`   - ${u.username} / ${u.password} (${u.role})`));
  console.log('');
});
