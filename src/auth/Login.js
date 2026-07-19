import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) return Alert.alert('Error', 'Please fill in all fields');
    setLoading(true);
    
    const { error } = await supabase.auth.signInWithPassword({ 
      email: email.trim(), 
      password: password 
    });
    
    if (error) Alert.alert('Authentication Failed', error.message);
    setLoading(false);
  }

  return (
    <View style={styles.outerContainer}>
      <View style={styles.card}>
        <View style={styles.logoContainer}>
          <Image source={require('../../assets/images/oracle-logo.png')} style={{ width: 200, height: 200, marginVertical: 12 }} /> 
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            placeholder="name@example.com"
            placeholderTextColor="#94a3b8"
            onChangeText={setEmail}
            value={email}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete={Platform.OS === 'web' ? 'email' : 'username'}
            style={styles.input}
          />
          
          <Text style={styles.label}>Password</Text>
          <TextInput
            placeholder="••••••••"
            placeholderTextColor="#94a3b8"
            onChangeText={setPassword}
            value={password}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            style={styles.input}
          />
        </View>

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { backgroundColor: '#ffffff', width: '100%', maxWidth: 420, padding: 32, borderRadius: 16, ...Platform.select({
      web: { boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' },
      default: { elevation: 4 }
    })
  },
  logoContainer: { alignItems: 'center' },
  logoText: { fontSize: 32, fontWeight: '800', color: '#002060', letterSpacing: 3 },
  logoSubtext: { fontSize: 12, color: '#475569', letterSpacing: 1.5, marginTop: 4, fontWeight: '600' },
  inputContainer: { marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  input: { backgroundColor: '#f8fafc', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', marginBottom: 16, fontSize: 15, color: '#1e293b' },
  button: { backgroundColor: '#002060', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});