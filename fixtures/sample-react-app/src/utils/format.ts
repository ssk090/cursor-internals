import type { User } from "../types";

export function formatUserName(user: User): string {
  return user.name.trim() || user.email;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
