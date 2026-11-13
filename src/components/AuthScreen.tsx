import { useState } from 'react';
import type React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export default function AuthScreen({ onGuest }: { onGuest: () => void }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!supabase) return;
    setLoading(true); setMessage('');
    try {
      const result = isSignUp
        ? await supabase.auth.signUp({ email, password, options: { data: { display_name: name || email.split('@')[0] } } })
        : await supabase.auth.signInWithPassword({ email, password });
      setMessage(result.error?.message ?? (isSignUp ? 'Check your email to confirm your account.' : ''));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not connect to the sign-in service. Try again.');
    } finally {
      setLoading(false);
    }
  };
  return <main className="auth-screen"><div className="auth-card"><div className="auth-brand"><div className="brand-mark"><Sparkles size={18}/></div><span>canvasly</span></div><h1>{isSupabaseConfigured ? isSignUp ? 'Create your account' : 'Welcome back' : 'Your ideas, on one canvas'}</h1><p>{isSupabaseConfigured ? 'Sign in to open and save your boards.' : 'Start a board and save it on this device.'}</p>
    {isSupabaseConfigured ? <form className="auth-form" onSubmit={submit}>{isSignUp && <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name"/></label>}<label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email"/></label><label>Password<input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" autoComplete={isSignUp ? 'new-password' : 'current-password'}/></label><button className="button button-primary auth-submit" disabled={loading}>{loading ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}<ArrowRight size={15}/></button>{message && <div className="auth-message" role="status">{message}</div>}<button type="button" className="auth-switch" onClick={() => { setIsSignUp(!isSignUp); setMessage(''); }}>{isSignUp ? 'Already have an account? Sign in' : 'New to Canvasly? Create an account'}</button></form> : <button className="button button-primary auth-submit" onClick={onGuest}>Continue with local boards<ArrowRight size={15}/></button>}
    {isSupabaseConfigured && <button className="auth-guest" onClick={onGuest}>Continue as a guest on this device</button>}
  </div></main>;
}
