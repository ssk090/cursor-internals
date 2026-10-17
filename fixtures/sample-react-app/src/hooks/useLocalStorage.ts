import { useEffect, useState } from "react";

export function useLocalStorage(
  key: string,
  initialValue: string,
): [string, (value: string) => void] {
  const [value, setValue] = useState(
    () => window.localStorage.getItem(key) ?? initialValue,
  );

  useEffect(() => {
    window.localStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue];
}
