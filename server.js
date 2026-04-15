const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');

const app = express();
app.use(cors());

// Cache extracted URLs (they expire after ~5 hours)
const cache = new Map();
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

app.get('/stream/:videoId', (req, res) => {
  const { videoId } = req.params;

  // Check cache
  const cached = cache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[CACHE HIT] ${videoId}`);
    return res.json({ url: cached.url });
  }

  try {
    console.log(`[EXTRACTING] ${videoId}...`);
    const raw = execSync(
      `yt-dlp -f "best[height<=720][ext=mp4]" -g "https://www.youtube.com/watch?v=${videoId}" 2>NUL`,
      { encoding: 'utf8', timeout: 25000 }
    ).trim();
    // yt-dlp may output warnings before URL — grab last line
    const url = raw.split('\n').filter(l => l.startsWith('http')).pop();
    if (!url) throw new Error('No URL found');

    cache.set(videoId, { url, expiresAt: Date.now() + CACHE_TTL });
    console.log(`[OK] ${videoId}`);
    res.json({ url });
  } catch (e) {
    console.error(`[ERROR] ${videoId}:`, e.message?.substring(0, 100));
    res.status(500).json({ error: 'Failed to extract stream URL' });
  }
});

// Batch endpoint: extract multiple videos at once
app.get('/batch', async (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  const results = {};

  for (const id of ids.slice(0, 10)) {
    const cached = cache.get(id);
    if (cached && Date.now() < cached.expiresAt) {
      results[id] = cached.url;
      continue;
    }
    try {
      const raw = execSync(
        `yt-dlp -f "best[height<=720][ext=mp4]" -g "https://www.youtube.com/watch?v=${id}" 2>NUL`,
        { encoding: 'utf8', timeout: 25000 }
      ).trim();
      const url = raw.split('\n').filter(l => l.startsWith('http')).pop();
      if (url) {
        cache.set(id, { url, expiresAt: Date.now() + CACHE_TTL });
        results[id] = url;
      } else {
        results[id] = null;
      }
    } catch {
      results[id] = null;
    }
  }

  res.json(results);
});

app.get('/health', (_, res) => res.json({ status: 'ok', cached: cache.size }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 Cinemati Stream Server running on port ${PORT}`);
  console.log(`   http://localhost:${PORT}/health`);

  // Show local IP for phone access
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   http://${net.address}:${PORT}/health  (use this in app)`);
      }
    }
  }
  console.log('');
});
