import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getTabHotel, setTabHotel, withTabHotel } from '@/lib/tabHotel';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  nickname?: string;
  profile_picture_url?: string;
  phone_number?: string;
  role: 'housekeeping' | 'reception' | 'maintenance' | 'manager' | 'admin' | 'marketing' | 'control_finance' | 'hr' | 'front_office' | 'top_management' | 'housekeeping_manager' | 'maintenance_manager' | 'marketing_manager' | 'reception_manager' | 'back_office_manager' | 'control_manager' | 'finance_manager' | 'top_management_manager' | 'breakfast_staff' | 'supervisor';
  created_at: string;
  updated_at: string;
  last_login?: string;
  assigned_hotel?: string;
  is_super_admin?: boolean;
  organization_slug?: string;
  acts_as_housekeeper?: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (emailOrUsername: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string, userEmail?: string, userMetadata?: any) => {
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profileData && !profileError) {
        console.log('Profile fetched:', profileData);
        const tabHotel = getTabHotel();
        if (tabHotel) {
          const { data: allowedHotel } = await supabase
            .from('hotel_configurations')
            .select('hotel_id')
            .or(`hotel_id.eq.${tabHotel},hotel_name.eq.${tabHotel}`)
            .maybeSingle();
          if (!allowedHotel) setTabHotel(null);
        }
        setProfile(withTabHotel(profileData as any) as any);
        return profileData;
      } else {
        // Tenant membership is privileged data. Never invent an organization
        // from the URL or silently place an unknown account into RD Hotels.
        console.warn('Profile not available; refusing to create an unscoped profile.', {
          userId,
          profileError,
          timestamp: new Date().toISOString()
        });
        setProfile(null);
        return null;
      }
    } catch (error) {
      console.error('Profile fetch error:', error);
      setProfile(null);
      return null;
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Listen for auth changes FIRST (following Supabase best practices)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        
        console.log('Auth state changed:', event, session?.user?.email);
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          setTimeout(() => {
            if (isMounted) {
              fetchProfile(session.user.id, session.user.email, session.user.user_metadata);
            }
          }, 0);
        } else {
          setProfile(null);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        fetchProfile(session.user.id, session.user.email, session.user.user_metadata).finally(() => {
          if (isMounted) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    // Re-validate session when tab becomes visible again (fixes rooms disappearing)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isMounted) {
        console.log('Tab became visible, re-validating session...');
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!isMounted) return;
          if (session?.user) {
            setSession(session);
            setUser(session.user);
            // Re-fetch profile to ensure fresh data
            fetchProfile(session.user.id, session.user.email, session.user.user_metadata);
          } else {
            console.warn('Session expired while tab was backgrounded');
            setUser(null);
            setSession(null);
            setProfile(null);
          }
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const signIn = async (emailOrUsername: string, password: string) => {
    console.log('Attempting login with:', emailOrUsername);
    
    // First try with email - attempt case-insensitive email lookup
    let { error } = await supabase.auth.signInWithPassword({
      email: emailOrUsername,
      password,
    });
    
    // If direct email fails, try case-insensitive email lookup
    if (error && emailOrUsername.includes('@')) {
      console.log('Direct email login failed, trying case-insensitive email lookup');
      try {
        const { data: emailData, error: rpcError } = await supabase.rpc('get_email_case_insensitive', {
          p_email: emailOrUsername,
        });
        console.log('Case-insensitive email RPC lookup:', emailData, rpcError);
        
        if (emailData) {
          console.log('Found email with case-insensitive lookup, attempting login with:', emailData);
          const result = await supabase.auth.signInWithPassword({
            email: emailData as string,
            password,
          });
          error = result.error;
          console.log('Case-insensitive email login result:', result.error);
        }
      } catch (lookupError) {
        console.error('Case-insensitive email lookup failed:', lookupError);
      }
    }
    
    // If email login fails and input doesn't contain @, try username lookup
    if (error && !emailOrUsername.includes('@')) {
      console.log('Email login failed, trying username lookup for:', emailOrUsername);
      try {
        // Resolve email via secure RPC to bypass RLS during pre-auth
        const { data: emailData, error: rpcError } = await supabase.rpc('get_email_by_nickname', {
          p_nickname: emailOrUsername,
        });
        console.log('Username RPC lookup result:', { emailData, rpcError });
        
        if (emailData && !rpcError) {
          console.log('Found email for username, attempting login');
          const result = await supabase.auth.signInWithPassword({
            email: emailData as string,
            password,
          });
          error = result.error;
          console.log('Username-based login result:', result.error ? 'failed' : 'success');
          
          // If password is wrong after finding username, provide clearer error
          if (error && error.message === 'Invalid login credentials') {
            error.message = 'Invalid password for username: ' + emailOrUsername;
          }
        } else if (rpcError) {
          console.error('Username lookup RPC error:', rpcError);
          error.message = 'Username not found: ' + emailOrUsername;
        } else {
          error.message = 'Username not found: ' + emailOrUsername;
        }
      } catch (lookupError) {
        console.error('Username lookup failed with exception:', lookupError);
        error.message = 'Username not found: ' + emailOrUsername;
      }
    }
    
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error };
  };

  const signOut = async () => {
    try {
      // Use 'local' scope to ensure complete sign out
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) {
        console.error('Sign out error:', error);
        // Force clear local state even if API call fails
        setUser(null);
        setSession(null);
        setProfile(null);
      }
    } catch (error) {
      console.error('Unexpected sign out error:', error);
      // Force clear local state
      setUser(null);
      setSession(null);
      setProfile(null);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      signIn,
      signUp,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};