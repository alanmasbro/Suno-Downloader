module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, proxy, id, filename } = req.query;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://suno.com/',
    'Origin': 'https://suno.com'
  };

  // MODE 1: Proxy file audio dengan fallback otomatis
  if (proxy) {
    try {
      const candidates = [proxy];
      const uuidMatch = proxy.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      const songId = id || (uuidMatch ? uuidMatch[0] : null);

      if (songId) {
        candidates.push(
          `https://cdn1.suno.ai/${songId}.mp3`,
          `https://cdn2.suno.ai/${songId}.mp3`,
          `https://audiopipe.suno.ai/?item_id=${songId}`
        );
      }

      let audioRes = null;
      let lastStatus = 500;

      for (const candidateUrl of [...new Set(candidates)]) {
        try {
          const parsed = new URL(candidateUrl);
          if (parsed.protocol !== 'https:') continue;

          const attempt = await fetch(candidateUrl, {
            redirect: 'follow',
            headers
          });

          lastStatus = attempt.status;
          const ct = attempt.headers.get('content-type') || '';

          if (attempt.ok && (ct.includes('audio') || ct.includes('octet-stream') || ct.includes('mp4'))) {
            audioRes = attempt;
            break;
          }
        } catch (_) {
          // Lanjut ke URL cadangan berikutnya
        }
      }

      if (!audioRes) {
        return res.status(502).json({
          error: `Gagal mengambil audio dari server Suno (Status: ${lastStatus}).`
        });
      }

      const contentType = audioRes.headers.get('content-type') || 'audio/mpeg';
      const buffer = Buffer.from(await audioRes.arrayBuffer());

      res.setHeader('Content-Type', contentType);
      if (filename) {
        const safeName = filename.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'suno-audio';
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mp3"`);
      }
      return res.status(200).send(buffer);
    } catch (err) {
      return res.status(500).json({ error: 'Terjadi kesalahan saat mengunduh audio.' });
    }
  }

  // MODE 2: Ambil detail lagu dari tautan Suno
  if (!url) {
    return res.status(400).json({ error: 'Masukkan link lagu Suno terlebih dahulu.' });
  }

  try {
    const pageRes = await fetch(url, {
      redirect: 'follow',
      headers
    });

    const finalUrl = pageRes.url;
    const html = await pageRes.text();

    const uuidMatch = finalUrl.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      || html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

    if (!uuidMatch) {
      return res.status(404).json({ error: 'Lagu tidak ditemukan. Pastikan link valid dan lagu bersifat publik.' });
    }

    const songId = uuidMatch[0];

    const getMeta = (prop) => {
      const r1 = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
      const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i');
      const match = html.match(r1) || html.match(r2);
      return match ? match[1] : null;
    };

    // Cari audio_url langsung dari data halaman Suno jika ada
    const jsonAudioMatch = html.match(/"audio_url"\s*:\s*"(https:[^"]+)"/i)
      || html.match(/\\?"audio_url\\?"\s*:\s*\\?"(https:[^"\\]+)/i);
    const extractedAudio = jsonAudioMatch ? jsonAudioMatch[1].replace(/\\u002F/g, '/') : null;

    const rawTitle = getMeta('og:title') || 'Lagu Suno';
    const title = rawTitle.replace(/\s*\|\s*Suno\s*$/i, '').trim();
    const image = getMeta('og:image') || `https://cdn2.suno.ai/image_${songId}.jpeg`;
    const audioUrl = extractedAudio || getMeta('og:audio') || `https://cdn1.suno.ai/${songId}.mp3`;

    return res.status(200).json({
      id: songId,
      title,
      image,
      audioUrl,
      sunoUrl: `https://suno.com/song/${songId}`
    });
  } catch (err) {
    return res.status(500).json({ error: 'Gagal memproses tautan Suno.' });
  }
};
