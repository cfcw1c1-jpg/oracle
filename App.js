import { useEffect, useState } from 'react';
import { Button, SafeAreaView, StyleSheet, View } from 'react-native';
import { supabase } from './lib/supabase';
import Login from './src/app/auth/Login';
import MembersList from './src/app/screens/MembersList';
import PfoList from './src/app/screens/PfoList';
import PfoReport from './src/app/screens/PfoReports';
import PredictorScreen from './src/app/screens/PredictorScreen';

export default function App() {
  const [session, setSession] = useState(null);
  const [currentTab, setCurrentTab] = useState('members'); 

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
  }, []);

  if (!session) {
    return <Login />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1 }}>
        {currentTab === 'members' && <MembersList />}
        {currentTab === 'pfo' && <PfoList />}
        {currentTab === 'pfoReports' && <PfoReport />}
        {currentTab === 'predictor' && <PredictorScreen />}

      </View>

      <View style={styles.navBar}>
        <Button title="Directory" onPress={() => setCurrentTab('members')} color={currentTab === 'members' ? '#002060' : '#888'} />
        <Button title="PFO Check" onPress={() => setCurrentTab('pfo')} color={currentTab === 'pfo' ? '#002060' : '#888'} />
        <Button title="Predictions" onPress={() => setCurrentTab('predictor')} color={currentTab === 'predictor' ? '#002060' : '#888'} />
        <Button title="Out" onPress={() => supabase.auth.signOut()} color="red" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  navBar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 10, borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' }
});