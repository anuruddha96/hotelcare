import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LockKeyhole, CheckCircle2, AlertCircle } from 'lucide-react';

/** The recovery email leads here after Supabase verifies its one-time token. */
export default function PasswordRecovery() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'missing' | 'success'>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session?.user) setStatus((old) => old === 'success' ? old : 'ready');
    });
    const check = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!active) return;
      if (error) setErrorMessage('The recovery link could not be verified. Request a new link.');
      setStatus(data.session?.user ? 'ready' : 'missing');
    };
    void check();
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const updatePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    if (password.length < 12 || password.length > 128) {
      setErrorMessage('Use a password between 12 and 128 characters.');
      return;
    }
    if (password !== confirmation) {
      setErrorMessage('The passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // End the temporary recovery session; next login must use the new password.
      await supabase.auth.signOut();
      setPassword('');
      setConfirmation('');
      setStatus('success');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not update your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            {status === 'success' ? <CheckCircle2 className="size-6" /> : <LockKeyhole className="size-6" />}
          </div>
          <CardTitle>{status === 'success' ? 'Password updated' : 'Set a new HotelCare password'}</CardTitle>
          <CardDescription>
            {status === 'success'
              ? 'Your password was changed successfully. You can now sign in using your new password.'
              : 'This page is protected by the secure, one-time password recovery link sent to your email.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'checking' && <p role="status" className="text-sm text-muted-foreground">Verifying your recovery link…</p>}
          {status === 'missing' && (
            <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 p-3 text-sm">
              <AlertCircle className="size-5 shrink-0 text-destructive" />
              This recovery link is invalid, expired, or already used. Please request a new link from the login page.
            </div>
          )}
          {status === 'success' && (
            <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
              Success! Your new password is ready to use.
            </p>
          )}
          {status === 'ready' && (
            <form className="space-y-4" onSubmit={updatePassword}>
              <div className="space-y-2">
                <Label htmlFor="recovery-password">New password</Label>
                <Input id="recovery-password" type="password" autoComplete="new-password"
                  minLength={12} maxLength={128} value={password}
                  onChange={(e) => setPassword(e.target.value)} required disabled={saving} />
                <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recovery-confirm">Confirm new password</Label>
                <Input id="recovery-confirm" type="password" autoComplete="new-password"
                  minLength={12} maxLength={128} value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)} required disabled={saving} />
              </div>
              {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? 'Updating password…' : 'Update password'}
              </Button>
            </form>
          )}
          {status !== 'ready' && errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
          <Button asChild variant="outline" className="w-full"><Link to="/auth">Return to sign in</Link></Button>
        </CardContent>
      </Card>
    </main>
  );
}
