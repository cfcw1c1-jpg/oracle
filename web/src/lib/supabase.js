import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://efelttlcyjfsvpxwmwjd.supabase.co';
const supabaseAnonKey = 'sb_publishable_eBC1oFxCx_8m_TNNZX1ioQ_Lf_u6rpA';

// Uses the same browser storage as the previous web build, so people stay
// signed in across the switch. Recovery links are handled in stores/session.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
