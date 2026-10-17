import { useCallback, useEffect, useState } from "react";
import { fetchUsers } from "../api/users";
import type { User } from "../types";

export type UsersState = {
  users: User[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useUsers(): UsersState {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchUsers()
      .then((result) => {
        if (!cancelled) setUsers(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load users");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { users, loading, error, reload };
}
