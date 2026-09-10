// TEMPORARY diagnostic endpoint - delete this file once the Stripe key issue
// is resolved. It never returns full secret values, only enough shape
// (length, a few characters, whitespace check) to spot a copy-paste issue
// or a missing/misscoped environment variable.
export const runtime = 'edge';

function describe(value) {
  if (typeof value !== 'string' || !value) {
    return { present: false };
  }
  return {
    present: true,
    length: value.length,
    hasLeadingOrTrailingWhitespace: value !== value.trim(),
    startsWith: value.slice(0, 12),
    endsWith: value.slice(-6)
  };
}

export default async function handler(req, res) {
  return res.status(200).json({
    STRIPE_SECRET_KEY: describe(process.env.STRIPE_SECRET_KEY),
    SUPABASE_SERVICE_ROLE_KEY: describe(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ANTHROPIC_API_KEY_present: !!process.env.ANTHROPIC_API_KEY
  });
}
