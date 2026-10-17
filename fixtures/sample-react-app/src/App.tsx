import { CustomerList } from "./components/CustomerList";
import { UserTable } from "./components/UserTable";

export function App() {
  return (
    <main>
      <h1>Users</h1>
      <UserTable />
      <h2>Customers</h2>
      <CustomerList />
    </main>
  );
}
