import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const supabaseUrl = 'https://efelttlcyjfsvpxwmwjd.supabase.co';
const supabaseAnonKey = 'sb_publishable_eBC1oFxCx_8m_TNNZX1ioQ_Lf_u6rpA';

// Secure SSR fallback storage helper
const customServerSafeStorage = {
  getItem: async (key) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') return null;
    return await AsyncStorage.getItem(key);
  },
  setItem: async (key, value) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') return;
    await AsyncStorage.setItem(key, value);
  },
  removeItem: async (key) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') return;
    await AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customServerSafeStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});