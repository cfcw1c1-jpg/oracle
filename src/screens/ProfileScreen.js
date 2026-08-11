import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const NAVY = '#002060';

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

function getInitials(email) {
  return (email || '?').slice(0, 2).toUpperCase();
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      setUser(data.user);
    } catch (err) {
      console.error('Error loading profile:', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePickAvatar() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showAlert('Permission Needed', 'Please allow photo library access to change your profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setAvatarUploading(true);

      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const fileExt = (asset.fileName?.split('.').pop() || asset.mimeType?.split('/').pop() || 'jpg').toLowerCase();
      const filePath = `${user.id}/avatar-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, blob, { contentType: asset.mimeType || 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const avatarUrl = publicUrlData.publicUrl;

      const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: avatarUrl } });
      if (updateError) throw updateError;

      // Also mirrored onto profiles.avatar_url -- auth.users.user_metadata
      // is only readable for your own session, but other accounts need to
      // see this picture too (Messages, Portal Users, etc.).
      const { error: profileError } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', user.id);
      if (profileError) throw profileError;

      setUser((prev) => ({ ...prev, user_metadata: { ...prev.user_metadata, avatar_url: avatarUrl } }));
      showAlert('Success', 'Profile picture updated.');
    } catch (err) {
      const isMissingBucket = err.message?.toLowerCase().includes('bucket not found');
      showAlert(
        'Upload Failed',
        isMissingBucket
          ? 'No "avatars" storage bucket exists yet. In your Supabase project, go to Storage > New bucket, create a public bucket named "avatars", then try again.'
          : err.message
      );
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleChangePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      showAlert('Missing Information', 'Please fill in all password fields.');
      return;
    }
    if (newPassword.length < 6) {
      showAlert('Password Too Short', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('Passwords Do Not Match', 'New password and confirmation must match.');
      return;
    }

    try {
      setChangingPassword(true);

      // Verify the current password is correct before allowing a change --
      // updateUser() alone would happily change the password of whoever
      // currently holds the session, with no re-authentication check.
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (verifyError) throw new Error('Current password is incorrect.');

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showAlert('Success', 'Your password has been changed.');
    } catch (err) {
      showAlert('Password Change Failed', err.message);
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading) return <ActivityIndicator size="large" color={NAVY} style={styles.centered} />;

  const email = user?.email || 'Unknown';
  const avatarUrl = user?.user_metadata?.avatar_url;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.heroSection}>
        <View style={styles.titleRow}>
          <Ionicons name="person-circle-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>My Profile</Text>
        </View>
        <Text style={styles.subtitle}>Manage your account picture and password.</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatarWrapper} onPress={handlePickAvatar} disabled={avatarUploading}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>{getInitials(email)}</Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              {avatarUploading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="camera" size={14} color="#ffffff" />
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>Tap to change profile picture</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email</Text>
          <Text style={styles.infoValue}>{email}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Member Since</Text>
          <Text style={styles.infoValue}>{formatDate(user?.created_at)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Last Sign-in</Text>
          <Text style={styles.infoValue}>{formatDate(user?.last_sign_in_at)}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Change Password</Text>

        <Text style={styles.inputLabel}>Current Password</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor="#94a3b8"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <Text style={styles.inputLabel}>New Password</Text>
        <TextInput
          style={styles.input}
          placeholder="At least 6 characters"
          placeholderTextColor="#94a3b8"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <Text style={styles.inputLabel}>Confirm New Password</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor="#94a3b8"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={[styles.saveButton, changingPassword && styles.saveButtonDisabled]}
          onPress={handleChangePassword}
          disabled={changingPassword}
        >
          {changingPassword ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.saveButtonText}>Update Password</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { paddingHorizontal: 16, paddingVertical: 16, paddingBottom: 40, maxWidth: 560, width: '100%', alignSelf: 'center' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  heroSection: { paddingVertical: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { marginRight: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4, lineHeight: 20 },

  card: {
    backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0',
    padding: 20, marginBottom: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a', marginBottom: 16 },

  avatarSection: { alignItems: 'center', marginBottom: 20 },
  avatarWrapper: { width: 88, height: 88, marginBottom: 10 },
  avatarImage: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#eff6ff' },
  avatarFallback: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: '#eff6ff',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarFallbackText: { fontSize: 28, fontWeight: '800', color: NAVY },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14,
    backgroundColor: NAVY, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#ffffff',
  },
  avatarHint: { fontSize: 12, color: '#94a3b8', fontWeight: '500' },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  infoLabel: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  infoValue: { fontSize: 13, color: '#0f172a', fontWeight: '700' },

  inputLabel: { fontSize: 11, fontWeight: '700', color: '#475569', textTransform: 'uppercase', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#1e293b',
  },

  saveButton: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: NAVY, borderRadius: 8, paddingVertical: 12, marginTop: 20,
  },
  saveButtonDisabled: { opacity: 0.7 },
  saveButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
