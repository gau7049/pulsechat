import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthResultDto, MeDto } from '@pulsechat/shared';
import { post, setAccessToken, setSessionExpiredHandler } from '../../lib/api';
import { getDeviceFingerprint } from '../../lib/fingerprint';
import { generateKeypair } from '../../lib/crypto/keys';

export type LoginResult =
  | { kind: 'session' }
  | { kind: 'otp_required'; pendingToken: string }
  | { kind: 'device_confirm_required'; maskedEmail: string };

interface RegisterInput {
  username: string;
  displayName: string;
  password: string;
  email?: string;
  birthDate?: string;
  turnstileToken?: string;
  /** Carried from an invite landing link — connects the signup to the inviter (§10.3). */
  inviteCode?: string;
}

interface AuthContextValue {
  user: MeDto | null;
  /** True while the initial silent session restore is in flight. */
  restoring: boolean;
  register: (input: RegisterInput) => Promise<void>;
  login: (username: string, password: string, turnstileToken?: string) => Promise<LoginResult>;
  verifyOtp: (pendingToken: string, code: string) => Promise<void>;
  verifyMagicLink: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Settings screens push fresh MeDto snapshots here after mutations. */
  setUser: (user: MeDto) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<MeDto | null>(null);
  const [restoring, setRestoring] = useState(true);

  const adoptSession = useCallback((result: AuthResultDto) => {
    setAccessToken(result.accessToken);
    setUserState(result.user);
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUserState(null);
  }, []);

  // Silent restore: the httpOnly refresh cookie is the only persisted secret.
  useEffect(() => {
    setSessionExpiredHandler(clearSession);
    void (async () => {
      try {
        const result = await post<AuthResultDto>('/auth/refresh');
        adoptSession(result);
      } catch {
        // No live session — the guest experience is fine.
      } finally {
        setRestoring(false);
      }
    })();
  }, [adoptSession, clearSession]);

  const register = useCallback(
    async (input: RegisterInput) => {
      // Client-side keypair (Technical Spec §6): private key never leaves here.
      const keypair = await generateKeypair(input.password);
      const result = await post<AuthResultDto>('/auth/register', {
        ...input,
        consent: true,
        publicKey: keypair.publicKey,
        deviceFingerprint: getDeviceFingerprint(),
      });
      await keypair.store(result.user.id);
      adoptSession(result);
    },
    [adoptSession],
  );

  const login = useCallback(
    async (username: string, password: string, turnstileToken?: string): Promise<LoginResult> => {
      const result = await post<
        | AuthResultDto
        | { otpRequired: true; pendingToken: string }
        | { deviceConfirmRequired: true; maskedEmail: string }
      >('/auth/login', {
        username,
        password,
        turnstileToken,
        deviceFingerprint: getDeviceFingerprint(),
      });
      if ('otpRequired' in result) {
        return { kind: 'otp_required', pendingToken: result.pendingToken };
      }
      if ('deviceConfirmRequired' in result) {
        return { kind: 'device_confirm_required', maskedEmail: result.maskedEmail };
      }
      adoptSession(result);
      return { kind: 'session' };
    },
    [adoptSession],
  );

  const verifyOtp = useCallback(
    async (pendingToken: string, code: string) => {
      adoptSession(await post<AuthResultDto>('/auth/otp/verify', { pendingToken, code }));
    },
    [adoptSession],
  );

  const verifyMagicLink = useCallback(
    async (token: string) => {
      adoptSession(
        await post<AuthResultDto>('/auth/magic-link/verify', {
          token,
          deviceFingerprint: getDeviceFingerprint(),
        }),
      );
    },
    [adoptSession],
  );

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const setUser = useCallback((next: MeDto) => setUserState(next), []);

  const value = useMemo(
    () => ({ user, restoring, register, login, verifyOtp, verifyMagicLink, logout, setUser }),
    [user, restoring, register, login, verifyOtp, verifyMagicLink, logout, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
