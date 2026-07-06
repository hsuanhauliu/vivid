import { useState, useEffect } from 'react';

/**
 * Persisted UI state: reads localStorage on mount, writes back on change.
 * `parse` maps the stored string → value (default identity), `serialize` maps
 * value → string (default String()). Replaces the repetitive useState-initializer
 * + useEffect-writer pairs that were scattered across the app.
 */
export default function usePersistentState(key, initial, parse = (v) => v, serialize = String) {
  const [value, setValue] = useState(() => {
    const raw = localStorage.getItem(key);
    return raw === null ? initial : parse(raw);
  });
  useEffect(() => {
    localStorage.setItem(key, serialize(value));
  }, [key, value]);
  return [value, setValue];
}

// Common parsers for the boolean-with-default settings.
export const boolDefaultTrue = (v) => v !== 'false'; // stored 'false' → false, else true
export const boolDefaultFalse = (v) => v === 'true';

/**
 * Build a `parse` for usePersistentState that JSON-decodes the stored string,
 * falling back to `fallback` when it's missing or corrupt. Pair with
 * `JSON.stringify` as the `serialize` argument.
 */
export const jsonParse = (fallback) => (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};
