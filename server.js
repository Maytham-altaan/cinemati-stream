const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');

const app = express();
app.use(cors());

// Cache extracted URLs (YouTube URLs expire after ~6 hours)
const cache = new Map();
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

/**
 * Extract direct MP4 URL from YouTube using ytdl-core.
 * Returns the best available muxed (video+audio) MP4 stream ≤720p.
 */
async function extractUrl(videoId) {
  try {
    const info = await ytdl.getInfo(videoId, { requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0' } } });
    const formats = info.formats
      .filter(f => f.container === 'mp4' && f.hasAudio && f.hasVideo && f.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    // Prefer ≤720p, fallback to any available
    const pick = formats.find(f => (f.height || 0) <= 720) || formats[0];
    return pick ? { url: pick.url, quality: pick.qualityLabel || `${pick.height}p` } : null;
  } catch (e) {
    console.error(`  [ytdl] error: ${e.message?.substring(0, 150)}`);
    return null;
  }
}

// ─── Single video extraction ───
app.get('/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;

  const cached = cache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[CACHE] ${videoId} (${cached.quality})`);
    return res.json({ url: cached.url, source: 'cache' });
  }

  try {
    console.log(`[EXTRACT] ${videoId}...`);
    const result = await extractUrl(videoId);

    if (!result) {
      console.error(`[FAIL] ${videoId}`);
      return res.status(500).json({ error: 'No playable format found' });
    }

    cache.set(videoId, { ...result, expiresAt: Date.now() + CACHE_TTL });
    console.log(`[OK] ${videoId} → ${result.quality}`);
    res.json({ url: result.url, source: 'ytdl-core' });
  } catch (e) {
    console.error(`[ERROR] ${videoId}:`, e.message?.substring(0, 200));
    res.status(500).json({ error: 'Extraction failed' });
  }
});

// ─── Batch extraction ───
app.get('/batch', async (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean).slice(0, 10);
  const results = {};

  for (const id of ids) {
    const cached = cache.get(id);
    if (cached && Date.now() < cached.expiresAt) {
      results[id] = cached.url;
      continue;
    }
    try {
      const result = await extractUrl(id);
      if (result) {
        cache.set(id, { ...result, expiresAt: Date.now() + CACHE_TTL });
        results[id] = result.url;
      } else {
        results[id] = null;
      }
    } catch { results[id] = null; }
  }

  res.json(results);
});

// ─── Health ───
app.get('/health', (_, res) => res.json({
  status: 'ok',
  cached: cache.size,
  version: 'v4-ytdl-core',
}));

// ─── Debug ───
app.get('/debug', async (_, res) => {
  let test = 'not tested';
  try {
    const result = await extractUrl('jNQXAC9IVRw');
    test = result
      ? `✓ ${result.quality} — ${result.url.substring(0, 100)}...`
      : '✗ No format found';
  } catch (e) { test = `✗ ${e.message?.substring(0, 150)}`; }
  res.json({ version: 'v4-ytdl-core', nodeVersion: process.version, test });
});

// ─── Start ───
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 Cinemati Stream v4 (ytdl-core) on port ${PORT}\n`);
});
