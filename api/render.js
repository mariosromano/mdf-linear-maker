import { checkRateLimit, rateLimitResponse } from './_rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit: FAL renders are ~$0.10 each. Cap per-IP to 5/hour.
  const rl = await checkRateLimit(req, 'render', { limit: 5, windowSec: 3600 });
  if (!rl.allowed) return rateLimitResponse(res, rl);

  // Key priority: env var > header (header lets local dev test with a personal key)
  const falKey = process.env.FAL_API_KEY || req.headers['x-fal-key'];
  if (!falKey) {
    return res.status(401).json({ error: 'Missing FAL API key.' });
  }

  const { image, prompt } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'No screenshot provided.' });
  }

  try {
    const uploadRes = await fetch('https://fal.run/fal-ai/nano-banana-pro/edit', {
      method: 'POST',
      headers: {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt:
          prompt ||
          'Decorative CNC-carved linear grooved wall panel in a luxury interior, realistic architectural photography, keep exact panel geometry and scale, accent lighting, high detail, 8K',
        image_urls: [`data:image/jpeg;base64,${image}`],
        num_images: 1,
        aspect_ratio: 'auto',
        output_format: 'png',
        resolution: '1K',
        safety_tolerance: '6',
      }),
    });

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text();
      return res
        .status(502)
        .json({ error: `FAL API error: ${uploadRes.status} — ${errBody}` });
    }

    const result = await uploadRes.json();
    const outputUrl = result.images?.[0]?.url || result.output?.url || null;

    if (!outputUrl) {
      return res.status(502).json({ error: 'No image returned from FAL.' });
    }

    res.json({ imageUrl: outputUrl, description: result.description || null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
}
