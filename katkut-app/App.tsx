import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import type { Session } from '@supabase/supabase-js';
import { MediaProbe, MediaProbeResult } from './native';
import { supabase } from './services/supabase';
import { signInWithGoogle, signOut } from './services/auth';

export default function App() {
  const [result, setResult] = useState<MediaProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handlePickAndProbe() {
    setError(null);
    setResult(null);

    const picked = await DocumentPicker.getDocumentAsync({ type: 'video/*' });
    if (picked.canceled) return;

    try {
      const probed = await MediaProbe.probe(picked.assets[0].uri);
      setResult(probed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSignIn() {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>KatKut — Phase 0 Smoke Test</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>1. Native media probe</Text>
        <Button title="Pick a video and probe it" onPress={handlePickAndProbe} />
        {result && (
          <View style={styles.resultBox}>
            <Text>durationMs: {result.durationMs}</Text>
            <Text>width: {result.width}</Text>
            <Text>height: {result.height}</Text>
            <Text>rotation: {result.rotation}</Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>2. Google sign-in (Supabase)</Text>
        {session ? (
          <>
            <Text>Signed in as: {session.user.email}</Text>
            <Button title="Sign out" onPress={() => signOut()} />
          </>
        ) : (
          <Button title="Sign in with Google" onPress={handleSignIn} />
        )}
        {authError && <Text style={styles.error}>{authError}</Text>}
      </View>

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  section: {
    gap: 8,
    alignItems: 'center',
  },
  sectionTitle: {
    fontWeight: '600',
  },
  resultBox: {
    gap: 4,
    alignItems: 'flex-start',
  },
  error: {
    color: 'red',
  },
});
