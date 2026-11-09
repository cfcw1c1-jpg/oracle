import { supabase } from './supabase';

// Shares the channel the mobile app uses, so Portal Users sees everyone online
// on either platform. Presence is live only; there is no history.
const CHANNEL_NAME = 'oracle_online_presence';

let channel = null;
let subscribed = false;
let pendingPayload = null;
const listeners = new Set();

function flattenState() {
  return Object.values(channel ? channel.presenceState() : {}).flat();
}

function notify() {
  const entries = flattenState();
  listeners.forEach((listener) => listener(entries));
}

function ensureChannel() {
  if (channel) return channel;
  channel = supabase.channel(CHANNEL_NAME);
  channel.on('presence', { event: 'sync' }, notify);
  channel.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return;
    subscribed = true;
    if (pendingPayload) {
      channel.track(pendingPayload);
      pendingPayload = null;
    }
    notify();
  });
  return channel;
}

export function trackPresence(profileId) {
  const active = ensureChannel();
  const payload = { profile_id: profileId, platform: 'web', online_at: new Date().toISOString() };
  if (subscribed) active.track(payload);
  else pendingPayload = payload;
  return () => {
    pendingPayload = null;
    if (subscribed) active.untrack();
  };
}

export function subscribeToPresence(onChange) {
  ensureChannel();
  listeners.add(onChange);
  onChange(flattenState());
  return () => listeners.delete(onChange);
}

export function formatPlatform(platform) {
  if (platform === 'ios') return 'iOS App';
  if (platform === 'android') return 'Android App';
  if (platform === 'web') return 'Web';
  return platform || 'Unknown';
}
