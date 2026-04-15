const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');

const app = express();
app.use(cors());

// Cache extracted URLs (they expire after ~5 hours)
const cache = new Map();
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// yt-dlp extraction strategies — try in order until one works
const STRATEGIES = [
  // Strategy 1: Default (web client)
  (videoId) => `yt-dlp -f "best[height<=720][ext=mp4]/best[height<=720]/best" --no-check-certificates --geo-bypass -g "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null`,
  // Strategy 2: Android client
  (videoId) => `yt-dlp -f "best[height<=720][ext=mp4]/best[height<=720]/best" --extractor-args "youtube:player_client=android" --no-check-certificates --geo-bypass -g "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null`,
  // Strategy 3: iOS client
  (videoId) => `yt-dlp -f "best[height<=720][ext=mp4]/best[height<=720]/best" --extractor-args "youtube:player_client=ios" --no-check-certificates --geo-bypass -g "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null`,
  // Strategy 4: mweb client
  (videoId) => `yt-dlp -f "best[height<=720][ext=mp4]/best[height<=720]/best" --extractor-args "youtube:player_client=mweb" --no-check-certificates --geo-bypass -g "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null`,
  // Strategy 5: tv_embedded client
  (videoId) => `yt-dlp -f "best[height<=720][ext=mp4]/best[height<=720]/best" --extractor-args "youtube:player_client=tv_embedded" --no-check-certificates --geo-bypass -g "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null`,
  // Strategy 6: mediaconnect client
  (videoId) => `yt-dlp -f "best[height<=720][ext=mp4]/best[height<=720]/best" --extractor-args "youtube:player_client=mediaconnect" --no-check-certificates --geo-bypass -g "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null`,
];

function extractUrl(videoId) {
  for (let i = 0; i < STRATEGIES.length; i++) {
    try {
      const cmd = STRATEGIES[i](videoId);
      console.log(`  [Strategy ${i + 1}] trying...`);
      const raw = execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim();
      const url = raw.split('\n').filter(l => l.startsWith('http')).pop();
      if (url) {
        console.log(`  [Strategy ${i + 1}] ✓ success`);
        return url;
      }
    } catch (e) {
      console.log(`  [Strategy ${i + 1}] ✗ failed`);
    }
  }

  // Last resort: get verbose error to diagnose
  try {
    const errOut = execSync(
      `yt-dlp -v -f "best[height<=720]" -g "https://www.youtube.com/watch?v=${videoId}" 2>&1`,
      { encoding: 'utf8', timeout: 30000 }
    ).trim();
    console.log(`  [VERBOSE] ${errOut.substring(0, 500)}`);
  } catch (e) {
    const msg = e.stderr || e.stdout || e.message || '';
    console.log(`  [VERBOSE ERROR] ${msg.substring(0, 500)}`);
  }

  return null;
}

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
    const url = extractUrl(videoId);

    if (!url) {
      console.error(`[FAILED] ${videoId}: No URL from any strategy`);
      return res.status(500).json({ error: 'Failed to extract stream URL' });
    }

    cache.set(videoId, { url, expiresAt: Date.now() + CACHE_TTL });
    console.log(`[OK] ${videoId}`);
    res.json({ url });
  } catch (e) {
    console.error(`[ERROR] ${videoId}:`, e.message?.substring(0, 200));
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
      console.log(`[BATCH] ${id}...`);
      const url = extractUrl(id);
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

app.get('/health', (_, res) => res.json({
  status: 'ok',
  cached: cache.size,
  version: 'v2-multi-strategy'
}));

// Debug endpoint to check yt-dlp version and test extraction
app.get('/debug', (_, res) => {
  let version = 'unknown';
  let testResult = 'not tested';
  try {
    version = execSync('yt-dlp --version', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch (e) {
    version = 'error: ' + e.message;
  }
  try {
    // Test with a known public video
    const raw = execSync(
      'yt-dlp -v -f "best[height<=720]" -g "https://www.youtube.com/watch?v=jNQXAC9IVRw" 2>&1',
      { encoding: 'utf8', timeout: 30000 }
    ).trim();
    testResult = raw.substring(0, 1000);
  } catch (e) {
    testResult = (e.stderr || e.stdout || e.message || '').substring(0, 1000);
  }
  res.json({ version, testResult });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 Cinemati Stream Server v2 running on port ${PORT}`);
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
