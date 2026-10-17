import { useState } from "react";
import { SearchInput } from "./SearchInput";

const CUSTOMERS = ["Ada Lovelace", "Grace Hopper", "Alan Turing"];

export function CustomerList() {
  const [query, setQuery] = useState("");
  const visible = CUSTOMERS.filter((name) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <section>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search customers..."
      />
      <ul>
        {visible.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </section>
  );
}
