import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getTabHotel, setTabHotel, withTabHotel } from '@/lib/tabHotel';
import { retryTransient } from '@/lib/transientRetry';

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
  preferred_language?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileStatus: 'idle' | 'loading' | 'retrying' | 'ready' | 'missing' | 'failed';
  bootstrapProgress: number;
  retryProfile: () => Promise<void>;
  signIn: (emailOrUsername: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  /** Apply a newly picked property to the in-memory profile (no page reload). */
  applyAssignedHotel: (hotelId: string) => void;
}


const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileStatus, setProfileStatus] = useState<AuthContextType['profileStatus']>('idle');
  const [bootstrapProgress, setBootstrapProgress] = useState(18);
  const lastVisibilityCheckRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(null);
  const profileRequestRef = useRef<{ userId: string; promise: Promise<Profile | null> } | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  const advanceBootstrap = (next: number) => {
    setBootstrapProgress((current) => Math.max(current, next));
  };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const fetchProfile = (userId: string): Promise<Profile | null> => {
    if (profileRequestRef.current?.userId === userId) return profileRequestRef.current.promise;

    activeUserIdRef.current = userId;
    setProfileStatus('loading');
    advanceBootstrap(36);
    const promise = retryTransient(async () => {
      const result = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    }, {
      attempts: 5,
      onRetry: (attempt, error) => {
        if (activeUserIdRef.current !== userId) return;
        setProfileStatus('retrying');
        advanceBootstrap(52);
        console.warn(`Profile request temporarily unavailable; retrying (${attempt}/4).`, error);
      },
    }).then((profileData) => {
      if (activeUserIdRef.current !== userId) return null;
      if (profileData) {
        console.log('Profile fetched:', profileData);
        const tabHotel = getTabHotel();
        if (tabHotel) {
          void supabase
            .from('hotel_configurations')
            .select('hotel_id')
            .or(`hotel_id.eq.${tabHotel},hotel_name.eq.${tabHotel}`)
            .maybeSingle()
            .then(({ data: allowedHotel, error }) => {
              if (!error && !allowedHotel) setTabHotel(null);
            });
        }
        setProfile(withTabHotel(profileData as any) as any);
        setProfileStatus('ready');
        reconnectAttemptRef.current = 0;
        clearReconnectTimer();
        advanceBootstrap(86);
        return profileData as Profile;
      }

      console.warn('Authenticated user has no profile; refusing to create an unscoped profile.', { userId });
      setProfile(null);
      setProfileStatus('missing');
      return null;
    }).catch((error) => {
      if (activeUserIdRef.current === userId) {
        console.error('Profile fetch failed after automatic retries:', error);
        setProfileStatus('failed');
        advanceBootstrap(52);
        if (reconnectTimerRef.current === null) {
          const reconnectDelay = Math.min(30000, 3000 * 2 ** Math.min(reconnectAttemptRef.current, 3));
          reconnectAttemptRef.current += 1;
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            if (activeUserIdRef.current === userId) void fetchProfile(userId);
          }, reconnectDelay);
        }
      }
      return null;
    }).finally(() => {
      if (profileRequestRef.current?.promise === promise) profileRequestRef.current = null;
    });

    profileRequestRef.current = { userId, promise };
    return promise;
  };

  const retryProfile = async () => {
    if (!user) return;
    clearReconnectTimer();
    profileRequestRef.current = null;
    await fetchProfile(user.id);
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
        const previousUserId = activeUserIdRef.current;
        activeUserIdRef.current = session?.user?.id ?? null;
        
        if (session?.user) {
          if (previousUserId && previousUserId !== session.user.id) setProfile(null);
          advanceBootstrap(28);
          setTimeout(() => {
            if (isMounted) {
              void fetchProfile(session.user.id);
            }
          }, 0);
        } else {
          clearReconnectTimer();
          setProfile(null);
          setProfileStatus('idle');
          setBootstrapProgress(18);
        }
      }
    );

    // THEN check for an existing session. Bound this call too: an expired
    // token may trigger a network refresh, and that must never hold the app's
    // initial loading screen indefinitely.
    void retryTransient(async () => {
      const result = await supabase.auth.getSession();
      if (result.error) throw result.error;
      return result.data.session;
    }, { attempts: 3, timeoutMs: 6000 }).then((session) => {
      if (!isMounted) return;

      setSession(session);
      setUser(session?.user ?? null);
      activeUserIdRef.current = session?.user?.id ?? null;

      if (session?.user) {
        advanceBootstrap(28);
        return fetchProfile(session.user.id);
      }
      setProfileStatus('idle');
      return null;
    }).catch((error) => {
      if (!isMounted) return;
      console.error('Session restoration failed after automatic retries:', error);
      setProfileStatus('failed');
    }).finally(() => {
      if (isMounted) setLoading(false);
    });

    // Re-validate an old session when the tab returns, but do not refetch the
    // full profile on every app switch. Auth change events already refresh the
    // profile when identity/claims actually change.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isMounted) {
        if (activeUserIdRef.current && profileStatus !== 'ready') {
          clearReconnectTimer();
          profileRequestRef.current = null;
          void fetchProfile(activeUserIdRef.current);
        }
        const now = Date.now();
        if (now - lastVisibilityCheckRef.current < 30 * 60 * 1000) return;
        lastVisibilityCheckRef.current = now;
        void retryTransient(async () => {
          const result = await supabase.auth.getSession();
          if (result.error) throw result.error;
          return result.data.session;
        }, { attempts: 2, timeoutMs: 6000 }).then((session) => {
          if (!isMounted) return;
          if (session?.user) {
            setSession(session);
            setUser(session.user);
          } else {
            console.warn('Session expired while tab was backgrounded');
            setUser(null);
            setSession(null);
            setProfile(null);
            setProfileStatus('idle');
          }
        }).catch((error) => {
          console.warn('Could not revalidate the session after returning to the tab.', error);
        });
      }
    };

    const handleOnline = () => {
      const userId = activeUserIdRef.current;
      if (!userId) return;
      clearReconnectTimer();
      profileRequestRef.current = null;
      void fetchProfile(userId);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      clearReconnectTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
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
    clearReconnectTimer();
    activeUserIdRef.current = null;
    profileRequestRef.current = null;
    setProfileStatus('idle');
    setBootstrapProgress(18);
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

  // Switching property is a client-state change: move the in-memory profile so
  // every hook refetches for the new hotel without rebooting the whole app.
  const applyAssignedHotel = (hotelId: string) => {
    setProfile((p) => (p ? ({ ...p, assigned_hotel: hotelId } as any) : p));
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      profileStatus,
      bootstrapProgress,
      retryProfile,
      signIn,
      signUp,
      signOut,
      applyAssignedHotel,
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