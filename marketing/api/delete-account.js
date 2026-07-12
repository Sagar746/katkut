// Deletes the calling user's own Supabase account (Apple guideline 5.1.1(v) / Google Play's
// equivalent in-app account deletion requirement). Requires the same env vars as
// stripe-webhook.js:
//   STRIPE_SECRET_KEY          - Stripe secret key
//   SUPABASE_URL               - same project as the app (EXPO_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY  - service_role key, needed for auth.admin.deleteUser
//
// SECURITY: the request body is NEVER trusted for "which account to delete" — a client-supplied
// uid would let anyone delete anyone else's account. The caller's own Supabase access token
// (Authorization: Bearer <token>) is verified server-side via supabase.auth.getUser(token), and
// the verified user id from THAT is the only id ever acted on.
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end('Method not allowed');
    return;
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  const userId = userData.user.id;

  try {
    // Best-effort: cancel any active subscription so it doesn't keep billing an account that no
    // longer exists. Never blocks deletion — an orphaned subscription is a lesser, loggable issue,
    // and the account must still be deletable even if Stripe is unreachable or already canceled.
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_subscription_id, stripe_subscription_status')
      .eq('id', userId)
      .maybeSingle();

    if (
      profile?.stripe_subscription_id &&
      (profile.stripe_subscription_status === 'active' || profile.stripe_subscription_status === 'trialing')
    ) {
      try {
        await stripe.subscriptions.cancel(profile.stripe_subscription_id);
      } catch (err) {
        console.error('delete-account: Stripe cancel failed, proceeding with deletion anyway', err);
      }
    }

    // profiles row cascades away automatically (ON DELETE CASCADE, see
    // supabase/migrations/001_profiles_pro_status.sql) — nothing else to clean up manually.
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('delete-account error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};
