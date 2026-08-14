import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';

// A single shared Realtime Presence channel for the whole app, one per
// browser tab / native session. Presence is Supabase's purpose-built
// mechanism for "who's connected right now" -- every client that tracks
// itself on this channel is mirrored to every other client subscribed to
// it, live, with no polling and no table of our own to maintain.
//
// It's inherently ephemeral, not a persisted "last seen" log: a tracked
// entry disappears within seconds of that client's socket closing
// (tab/app closed, network drop, sign-out), which is exactly what "online
// now" should mean, but means there's no history to query afterward.
const CHANNEL_NAME = 'oracle_online_presence';

let channel = null;
let subscribed = false;
let pendingTrackPayload = null;
const listeners = new Set();

function flattenState() {
  const state = channel ? channel.presenceState() : {};
  return Object.values(state).flatMap((metas) => metas);
}

function notifyListeners() {
  const entries = flattenState();
  listeners.forEach((fn) => fn(entries));
}

function ensureChannel() {
  if (channel) return channel;
  channel = supabase.channel(CHANNEL_NAME);
  channel.on('presence', { event: 'sync' }, notifyListeners);
  channel.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return;
    subscribed = true;
    if (pendingTrackPayload) {
      channel.track(pendingTrackPayload);
      pendingTrackPayload = null;
    }
    notifyListeners();
  });
  return channel;
}

// Marks this session online for as long as it stays mounted -- call once a
// session exists (see src/app/index.js) and run the returned cleanup on
// sign-out. platform is whatever Platform.OS reports (`ios` / `android` /
// `web`), which is all "what device are they on" means here -- there's no
// browser/OS fingerprinting beyond that.
export function trackPresence(profileId) {
  if (!profileId) return () => {};
  const ch = ensureChannel();
  const payload = { profile_id: profileId, platform: Platform.OS, online_at: new Date().toISOString() };

  if (subscribed) {
    ch.track(payload);
  } else {
    pendingTrackPayload = payload;
  }

  return () => {
    pendingTrackPayload = null;
    if (subscribed) ch.untrack();
  };
}

// Read-only subscription to the live online list, for a screen (Portal
// Users) that wants to show who's currently connected. Fires immediately
// with whatever snapshot is already known, then again on every change.
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
