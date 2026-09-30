// Vercel serverless function — mirrors the existing /api/supabase-config pattern.
// Returns ONLY the public, client-side Paddle token (never a server API key).
// Fails loudly (HTTP 500) if the environment or live token is missing/invalid.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store"); // country differs per visitor

  const environment = process.env.PADDLE_ENVIRONMENT;
  // Accepts PADDLE_CLIENT_TOKEN, or the existing NEXT_PUBLIC_PADDLE_CLIENT_TOKEN already set on Vercel.
  const token = process.env.PADDLE_CLIENT_TOKEN || process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;

  if (!environment) {
    return res.status(500).json({ error: "PADDLE_ENVIRONMENT is not set (must be 'production')." });
  }
  if (environment !== "production") {
    return res.status(500).json({ error: "PADDLE_ENVIRONMENT must be 'production' (live). Got: " + environment });
  }
  if (!token) {
    return res.status(500).json({ error: "PADDLE_CLIENT_TOKEN (or NEXT_PUBLIC_PADDLE_CLIENT_TOKEN) is not set." });
  }
  if (!token.startsWith("live_")) {
    return res.status(500).json({ error: "PADDLE_CLIENT_TOKEN must be a live client-side token (starts with live_)." });
  }

  // Country from Vercel's edge header. If absent/invalid -> null, so the client
  // omits `address` and Paddle auto-detects from the visitor's IP. No fake codes.
  const raw = String(req.headers["x-vercel-ip-country"] || "").toUpperCase();
  const country = /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : null;

  return res.status(200).json({ environment: "production", token, country });
};
