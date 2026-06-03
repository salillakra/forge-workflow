import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { User, Organization } from "@/types";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  currentOrg: Organization | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setCurrentOrg: (org: Organization) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      currentOrg: null,

      setAuth: (user, accessToken, refreshToken) => {
        localStorage.setItem("forge_access_token", accessToken);
        localStorage.setItem("forge_refresh_token", refreshToken);
        set({ user, accessToken, refreshToken });
      },

      setCurrentOrg: (org) => set({ currentOrg: org }),

      logout: () => {
        localStorage.removeItem("forge_access_token");
        localStorage.removeItem("forge_refresh_token");
        set({ user: null, accessToken: null, refreshToken: null, currentOrg: null });
      },

      isAuthenticated: () => !!get().accessToken && !!get().user,
    }),
    {
      name: "forge-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        currentOrg: state.currentOrg,
      }),
    }
  )
);
