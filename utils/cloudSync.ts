// utils/cloudSync.ts
import { createClient } from '@supabase/supabase-js';
import { buildCloudRowsForCampaign, CloudRow } from './buildCloudRows';
import { Campaign } from '../data/campaignsData';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function syncCampaignToSupabase(campaign: Campaign): Promise<{ count: number }> {
  const rows = await buildCloudRowsForCampaign(campaign);

  // Attach user_id on the fly via RPC header (auth) or by passing it in:
  // If you sign in with supabase.auth, user_id will be set by policies (auth.uid()).
  const { data, error } = await supabase
    .from('campaign_rows')
    .insert(rows.map((r: CloudRow) => ({
      ...r,
      // timestamp text -> timestamptz (null if empty)
      timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : null,
    }))) as { data: any[] | null, error: any };

  if (error) throw new Error(error.message);
  return { count: data?.length ?? 0 };
}
