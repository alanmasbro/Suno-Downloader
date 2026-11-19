module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, proxy, filename } = req.query;

  // MODE 1: Proxy file audio agar bisa didownload & dikonversi di browser
  if (proxy) {
    try {
      const targetUrl = new URL(proxy);
      const allowedHosts = ['cdn1.suno.ai', 'cdn2.suno.ai', 'suno.ai', 'suno.com', 'audiopipe.suno.ai'];
      if (!allowedHosts.some(h => targetUrl.hostname === h || targetUrl.hostname.endsWith('.' + h))) {
        return res.status(403).json({ error: 'Domain audio tidak diizinkan.' });
      }

      const audioRes = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!audioRes.ok) {
        return res.status(audioRes.status).json({ error: 'Gagal mengambil audio dari server Suno.' });
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
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
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

    const rawTitle = getMeta('og:title') || 'Lagu Suno';
    const title = rawTitle.replace(/\s*\|\s*Suno\s*$/i, '').trim();
    const image = getMeta('og:image') || `https://cdn2.suno.ai/image_${songId}.jpeg`;
    const audioUrl = getMeta('og:audio') || `https://cdn1.suno.ai/${songId}.mp3`;

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
