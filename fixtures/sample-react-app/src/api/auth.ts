import { apiGet } from "./client";

export type Session = {
  token: string;
  expiresAt: number;
};

let currentSession: Session | null = null;

export async function refreshToken(): Promise<string> {
  const session = await apiGet<Session>("/api/session/refresh");
  currentSession = session;
  return session.token;
}

export function getToken(): string | null {
  return currentSession?.token ?? null;
}
