export default function handler(req, res) {
  res.json({
    hasFalKey: !!process.env.FAL_API_KEY,
  });
}
