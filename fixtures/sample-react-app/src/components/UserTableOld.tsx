import { useState } from "react";
import type { User } from "../types";

// Legacy table kept around until the redesign ships.
export function UserTableOld({ users }: { users: User[] }) {
  const [query, setQuery] = useState("");

  // TODO: debounce this input before it ships.
  const visible = users.filter(
    (user) => user.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="user-table-old">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter users"
      />
      <ul>
        {visible.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
}
