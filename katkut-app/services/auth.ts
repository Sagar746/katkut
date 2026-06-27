import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export async function signInWithGoogle() {
  const redirectTo = Linking.createURL('auth/callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    throw new Error('Google sign-in was cancelled or failed.');
  }

  const url = new URL(result.url.replace('#', '?'));
  const access_token = url.searchParams.get('access_token');
  const refresh_token = url.searchParams.get('refresh_token');
  if (!access_token || !refresh_token) {
    throw new Error('No session tokens returned from Supabase.');
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (sessionError) throw sessionError;
}

export async function signOut() {
  await supabase.auth.signOut();
}
