import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Navigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';

export default function Auth() {
  const { signIn, signUp, user, loading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    const { error } = await signIn(email, password);
    
    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Success',
        description: 'Welcome back!',
      });
    }
    
    setIsLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const fullName = formData.get('fullName') as string;

    const { error } = await signUp(email, password, fullName);
    
    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Success',
        description: 'Account created! Please check your email to verify your account.',
      });
    }
    
    setIsLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get('reset-email') as string;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    
    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Success',
        description: 'Password reset email sent! Check your inbox.',
      });
      setForgotPasswordOpen(false);
    }
    
    setResetLoading(false);
  };

  const handleResendVerification = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get('resend-email') as string;

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      }
    });
    
    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Success',
        description: 'Verification email sent! Check your inbox.',
      });
      setForgotPasswordOpen(false);
    }
    
    setResetLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#359FDB]/10 to-[#6B6B6B]/5 p-4">
      <Card className="w-full max-w-lg shadow-2xl border-0">
        <CardHeader className="text-center space-y-4 pb-6">
          <div className="mx-auto w-20 h-20 bg-gradient-to-r from-[#359FDB] to-[#6B6B6B] rounded-full flex items-center justify-center">
            <div className="text-white font-bold text-2xl">RD</div>
          </div>
          <CardTitle className="text-3xl font-bold bg-gradient-to-r from-[#359FDB] to-[#6B6B6B] bg-clip-text text-transparent">
            Hotel Management Dashboard
          </CardTitle>
          <CardDescription className="text-base">
            Manage all hotel operations - rooms, maintenance, housekeeping, and service tickets
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    name="email"
                    type="email"
                    required
                    placeholder="Enter your email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    name="password"
                    type="password"
                    required
                    placeholder="Enter your password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Signing In...' : 'Sign In'}
                </Button>
                
                <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full mt-2">
                      Forgot Password / Resend Verification
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Reset Password or Resend Verification</DialogTitle>
                      <DialogDescription>
                        Choose an option to reset your password or resend email verification.
                      </DialogDescription>
                    </DialogHeader>
                    <Tabs defaultValue="reset" className="w-full">
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="reset">Reset Password</TabsTrigger>
                        <TabsTrigger value="resend">Resend Verification</TabsTrigger>
                      </TabsList>
                      
                      <TabsContent value="reset">
                        <form onSubmit={handleForgotPassword} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="reset-email">Email</Label>
                            <Input
                              id="reset-email"
                              name="reset-email"
                              type="email"
                              required
                              placeholder="Enter your email"
                            />
                          </div>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? 'Sending...' : 'Send Reset Link'}
                          </Button>
                        </form>
                      </TabsContent>
                      
                      <TabsContent value="resend">
                        <form onSubmit={handleResendVerification} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="resend-email">Email</Label>
                            <Input
                              id="resend-email"
                              name="resend-email"
                              type="email"
                              required
                              placeholder="Enter your email"
                            />
                          </div>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? 'Sending...' : 'Resend Verification'}
                          </Button>
                        </form>
                      </TabsContent>
                    </Tabs>
                  </DialogContent>
                </Dialog>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full Name</Label>
                  <Input
                    id="signup-name"
                    name="fullName"
                    type="text"
                    required
                    placeholder="Enter your full name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    name="email"
                    type="email"
                    required
                    placeholder="Enter your email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    name="password"
                    type="password"
                    required
                    placeholder="Create a password"
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Creating Account...' : 'Sign Up'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}