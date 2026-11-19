module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, proxy, id, filename } = req.query;

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // MODE 1: Proxy file audio (coba tanpa Referer dulu agar tidak kena blokir 403 CDN)
  if (proxy) {
    try {
      const candidates = [proxy];
      const uuidMatch = proxy.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      const songId = id || (uuidMatch ? uuidMatch[0] : null);

      if (songId) {
        candidates.push(
          `https://cdn1.suno.ai/${songId}.mp3`,
          `https://cdn1.suno.ai/${songId}.m4a`,
          `https://cdn2.suno.ai/${songId}.mp3`,
          `https://audiopipe.suno.ai/?item_id=${songId}`
        );
      }

      const headerVariants = [
        { 'User-Agent': ua },
        { 'User-Agent': ua, 'Referer': 'https://suno.com/' }
      ];

      let audioRes = null;
      let lastStatus = 500;

      outer:
      for (const candidateUrl of [...new Set(candidates)]) {
        for (const h of headerVariants) {
          try {
            const parsed = new URL(candidateUrl);
            if (parsed.protocol !== 'https:') continue;

            const attempt = await fetch(candidateUrl, { redirect: 'follow', headers: h });
            lastStatus = attempt.status;
            const ct = attempt.headers.get('content-type') || '';

            if (attempt.ok && !ct.includes('text/html') && !ct.includes('application/json')) {
              audioRes = attempt;
              break outer;
            }
          } catch (_) {}
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

  // MODE 2: Ambil detail lagu & audio_url resmi dari API publik Suno
  if (!url) {
    return res.status(400).json({ error: 'Masukkan link lagu Suno terlebih dahulu.' });
  }

  try {
    // 1. Cari ID lagu (UUID) dari link langsung atau setelah redirect link pendek
    let songId = null;
    const directUuid = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    let html = '';

    if (directUuid) {
      songId = directUuid[0];
    } else {
      const pageRes = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': ua } });
      html = await pageRes.text();
      const found = pageRes.url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
        || html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (found) songId = found[0];
    }

    if (!songId) {
      return res.status(404).json({ error: 'ID lagu tidak ditemukan. Pastikan link Suno valid.' });
    }

    let title = null;
    let image = null;
    let audioUrl = null;

    // 2. Ambil data resmi dari API publik Suno
    try {
      const apiRes = await fetch(`https://studio-api.prod.suno.com/api/clip/${songId}`, {
        headers: { 'User-Agent': ua }
      });
      if (apiRes.ok) {
        const clip = await apiRes.json();
        title = clip.title || title;
        image = clip.image_large_url || clip.image_url || image;
        audioUrl = clip.audio_url || audioUrl;
      }
    } catch (_) {}

    // 3. Cadangan: ambil dari halaman HTML jika API tidak mengembalikan audio_url
    if (!audioUrl || !title) {
      if (!html) {
        const pageRes = await fetch(`https://suno.com/song/${songId}`, {
          redirect: 'follow',
          headers: { 'User-Agent': ua }
        });
        html = await pageRes.text();
      }

      const getMeta = (prop) => {
        const r1 = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
        const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i');
        const match = html.match(r1) || html.match(r2);
        return match ? match[1] : null;
      };

      const rawTitle = getMeta('og:title') || 'Lagu Suno';
      if (!title) title = rawTitle.replace(/\s*\|\s*Suno\s*$/i, '').trim();
      if (!image) image = getMeta('og:image') || `https://cdn2.suno.ai/image_${songId}.jpeg`;

      if (!audioUrl) {
        const mediaMatch = html.match(/https:\/\/[^"'\s\\]+\.(mp3|m4a|wav)(\?[^"'\s\\]*)?/i);
        audioUrl = (mediaMatch ? mediaMatch[0] : null) || getMeta('og:audio') || `https://cdn1.suno.ai/${songId}.mp3`;
      }
    }

    return res.status(200).json({
      id: songId,
      title: title || 'Lagu Suno',
      image: image || `https://cdn2.suno.ai/image_${songId}.jpeg`,
      audioUrl,
      sunoUrl: `https://suno.com/song/${songId}`
    });
  } catch (err) {
    return res.status(500).json({ error: 'Gagal memproses tautan Suno.' });
  }
};
