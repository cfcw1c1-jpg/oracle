import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';

// Foreground presentation: still show the OS banner/sound even while the
// app is open, on top of the separate in-app toast driven by the
// `messages` realtime subscription in src/app/index.js -- that toast is
// skipped while the Messages tab itself is open, this banner is not, so
// there's no double-notifying in the case that matters.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Remote push isn't available in Expo Go on Android (SDK 53+) or without
// an EAS projectId -- both cases fail soft here (null token, nothing
// registered) rather than throwing, since a dev client / production build
// is what actually needs this to work.
export async function registerForPushNotificationsAsync(profileId) {
  if (Platform.OS === 'web' || !profileId) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#002060',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn('No EAS projectId configured in app.json -- run `eas init` to enable push notifications.');
    return null;
  }

  let token;
  try {
    const response = await Notifications.getExpoPushTokenAsync({ projectId });
    token = response.data;
  } catch (err) {
    console.error('Error getting Expo push token:', err.message);
    return null;
  }

  const { error } = await supabase
    .from('push_tokens')
    .upsert({ profile_id: profileId, token, platform: Platform.OS }, { onConflict: 'token' });
  if (error) console.error('Error saving push token:', error.message);

  return token;
}

// Fires when the user taps a delivered notification (app backgrounded,
// killed-then-relaunched, or foregrounded). The tapped notification's
// `data` payload is handed straight to the caller to route on -- shape
// varies by which Edge Function sent it: send-message-notification sets
// `conversationId`, send-change-request-notification sets
// `type: 'changeRequest'`.
export function addNotificationTapListener(onNotificationTapped) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    onNotificationTapped(response.notification.request.content.data || {});
  });
}
