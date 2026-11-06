"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { api } from "@/lib/client/api";

export interface ClientUser {
  id: string;
  email: string;
  name: string;
  role: "customer" | "staff" | "admin";
  emailVerified: boolean;
  isGuest?: boolean;
}

interface Ctx {
  user: ClientUser | null;
  refresh: () => Promise<void>;
  setUser: (u: ClientUser | null) => void;
  cartCount: number;
  setCartCount: (n: number) => void;
}

const SessionContext = createContext<Ctx>({ user: null, refresh: async () => undefined, setUser: () => undefined, cartCount: 0, setCartCount: () => undefined });

export function SessionProvider({ initialUser, initialCartCount, children }: { initialUser: ClientUser | null; initialCartCount: number; children: React.ReactNode }) {
  const [user, setUser] = useState<ClientUser | null>(initialUser);
  const [cartCount, setCartCount] = useState(initialCartCount);
  const refresh = useCallback(async () => {
    const r = await api<{ user: ClientUser | null }>("/api/auth/me");
    setUser(r.user);
  }, []);
  return <SessionContext.Provider value={{ user, refresh, setUser, cartCount, setCartCount }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
