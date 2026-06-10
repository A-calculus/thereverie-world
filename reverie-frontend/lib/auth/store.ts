import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  walletAddress?: string;
  githubId?: string;
  githubUsername?: string;
  fullName?: string;
  profilePicUrl?: string;
  email?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setWallet: (address: string) => void;
  setGithubProfile: (profile: Partial<Pick<User, 'githubId' | 'githubUsername' | 'fullName' | 'profilePicUrl' | 'email'>>) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      setUser: (user) =>
        set({ user, isAuthenticated: !!user }),

      setWallet: (address) =>
        set((state) => ({
          user: state.user
            ? { ...state.user, walletAddress: address }
            : { id: address, walletAddress: address },
          isAuthenticated: true,
        })),

      setGithubProfile: (profile) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...profile } : null,
        })),

      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    {
      name: 'reverie-auth',
      // Only persist the user object, not functions
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
