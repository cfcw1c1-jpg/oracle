import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Every route (index.js, training-lookup.js, clp-registration.js) uses
// SafeAreaView from react-native-safe-area-context so Android actually
// gets real status-bar insets -- its web implementation reads insets via
// context and throws without a SafeAreaProvider somewhere above it.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Slot />
    </SafeAreaProvider>
  );
}
