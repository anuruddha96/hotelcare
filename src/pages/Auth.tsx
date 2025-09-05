import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff } from 'lucide-react';

export default function Auth() {
  const { signIn, signUp, user, loading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-mesh">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent animate-glow"></div>
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
    const emailOrUsername = formData.get('email') as string;
    const password = formData.get('password') as string;

    // For now, just use direct sign in - username functionality can be added later
    const { error } = await signIn(emailOrUsername, password);
    
    if (error) {
      toast.error(error.message || 'Invalid login credentials');
    } else {
      toast.success('Welcome back!');
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
      toast.error(error.message || 'Could not create account');
    } else {
      toast.success('Account created! Please check your email to verify your account.');
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
      toast.error(error.message || 'Failed to send reset email');
    } else {
      toast.success('Password reset email sent! Check your inbox.');
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
      toast.error(error.message || 'Failed to resend verification');
    } else {
      toast.success('Verification email sent! Check your inbox.');
      setForgotPasswordOpen(false);
    }
    
    setResetLoading(false);
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
        <div className="w-full max-w-2xl">
          
          {/* Header Section */}
          <div className="text-center mb-8 space-y-6">
            <div className="mx-auto w-20 h-20 bg-white rounded-2xl shadow-lg flex items-center justify-center">
              <img 
                src="/lovable-uploads/f8d09d0b-f11c-4c6e-88b7-dff8c26a8824.png" 
                alt="RD Hotels" 
                className="w-12 h-12 object-contain"
              />
            </div>
            
            <div className="space-y-3">
              <h1 className="text-3xl lg:text-4xl font-bold">
                <span className="text-slate-700">Welcome to </span>
                <span className="text-slate-700">RD </span>
                <span className="text-blue-500">Hotels</span>
              </h1>
              <p className="text-slate-600 text-base lg:text-lg max-w-2xl mx-auto leading-relaxed">
                Manage all hotel operations - rooms, maintenance, housekeeping, and service tickets
              </p>
            </div>
          </div>

          {/* Login Card */}
          <Card className="w-full bg-white/80 backdrop-blur-sm border-0 shadow-xl">
            {/* Tab Navigation */}
            <div className="border-b border-slate-200">
              <div className="flex">
                <button className="flex-1 py-4 px-6 text-center font-medium text-slate-700 border-b-2 border-blue-500 bg-blue-50/50">
                  Sign In
                </button>
                <button className="flex-1 py-4 px-6 text-center font-medium text-slate-500 border-b-2 border-transparent hover:text-slate-700">
                  Sign Up
                </button>
              </div>
            </div>
            
            <CardContent className="p-8 lg:p-10">
              <form onSubmit={handleSignIn} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="signin-email" className="text-sm lg:text-base font-medium text-slate-700">
                    Email or Username
                  </Label>
                  <Input
                    id="signin-email"
                    name="email"
                    type="text"
                    required
                    placeholder="Enter your email or username"
                    className="h-12 lg:h-14 text-base border-slate-200 focus:border-blue-400 focus:ring-blue-400"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="signin-password" className="text-sm lg:text-base font-medium text-slate-700">
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="signin-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="Enter your password"
                      className="h-12 lg:h-14 text-base pr-12 border-slate-200 focus:border-blue-400 focus:ring-blue-400"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-12 lg:h-14 px-3 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5 text-slate-400" />
                      ) : (
                        <Eye className="h-5 w-5 text-slate-400" />
                      )}
                    </Button>
                  </div>
                </div>
                
                <Button 
                  type="submit" 
                  className="w-full h-12 lg:h-14 text-base lg:text-lg font-medium bg-blue-400 hover:bg-blue-500 text-white border-0" 
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Signing In...</span>
                    </div>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              </form>
              
              <div className="mt-6 text-center">
                <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" className="text-sm lg:text-base text-slate-600 hover:text-blue-600 hover:bg-transparent p-0">
                      Forgot Password / Resend Verification
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="w-[95vw] max-w-md bg-white/95 backdrop-blur-sm">
                    <DialogHeader>
                      <DialogTitle>Reset Password</DialogTitle>
                      <DialogDescription>
                        Enter your email to receive a password reset link
                      </DialogDescription>
                    </DialogHeader>
                    
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="reset-email">Email Address</Label>
                        <Input
                          id="reset-email"
                          name="reset-email"
                          type="email"
                          required
                          placeholder="your@email.com"
                          className="h-11 border-slate-200 focus:border-blue-400 focus:ring-blue-400"
                        />
                      </div>
                      <Button 
                        type="submit" 
                        className="w-full bg-blue-400 hover:bg-blue-500" 
                        disabled={resetLoading}
                      >
                        {resetLoading ? (
                          <div className="flex items-center space-x-2">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Sending...</span>
                          </div>
                        ) : (
                          'Send Reset Link'
                        )}
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}