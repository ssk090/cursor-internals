import type { User } from "../types";
import { apiGet } from "./client";

export function buildUsersUrl(): string {
  return "/api/users";
}

export async function fetchUsers(): Promise<User[]> {
  return apiGet<User[]>(buildUsersUrl());
}

export async function fetchUserById(id: string): Promise<User> {
  return apiGet<User>(`/api/users/${encodeURIComponent(id)}`);
}
