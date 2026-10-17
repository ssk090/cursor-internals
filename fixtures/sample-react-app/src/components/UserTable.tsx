import { useUsers } from "../hooks/useUsers";
import { Spinner } from "./Spinner";
import { ErrorBanner } from "./ErrorBanner";
import { formatUserName } from "../utils/format";

export function UserTable() {
  const { users, loading, error, reload } = useUsers();

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;

  return (
    <table className="user-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id}>
            <td>{formatUserName(user)}</td>
            <td>{user.email}</td>
            <td>{user.role}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
