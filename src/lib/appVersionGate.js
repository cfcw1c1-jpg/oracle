import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';

// Numeric, dot-separated comparison ("1.10.0" > "1.9.0", unlike a plain
// string compare) -- negative if a < b, 0 if equal, positive if a > b.
// Missing/non-numeric segments count as 0, so "1.4" and "1.4.0" are equal.
export function compareVersions(a, b) {
  const partsA = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Compares this install's version (baked into the native build from
// app.json's "version" at `eas build` time -- there's no expo-updates/OTA
// in this project, so it can't drift from what the store actually shipped)
// against the Admin-configured minimum for this platform. Returns null
// ("carry on") unless the installed version is strictly below a
// configured minimum; fails soft (also null) on any error, missing row,
// unset minimum, or web -- this is a native-only, opt-in gate.
export async function checkForceUpdate() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;

  const { data, error } = await supabase
    .from('app_version_requirements')
    .select('*')
    .eq('id', true)
    .maybeSingle();
  if (error || !data) return null;

  const minVersion = Platform.OS === 'ios' ? data.min_ios_version : data.min_android_version;
  if (!minVersion) return null;

  const currentVersion = Constants.expoConfig?.version;
  if (!currentVersion) return null;

  if (compareVersions(currentVersion, minVersion) >= 0) return null;

  return {
    currentVersion,
    minVersion,
    storeUrl: (Platform.OS === 'ios' ? data.ios_store_url : data.android_store_url) || null,
    message: data.update_message || null,
  };
}

// Re-runs the check whenever an Admin changes the requirement, so an
// already-open app on native picks up a newly-forced update live rather
// than only on next launch.
export function subscribeToForceUpdateChanges(onChange) {
  const channel = supabase
    .channel('app_version_requirements_watch')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_version_requirements' },
      () => { checkForceUpdate().then(onChange); }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
