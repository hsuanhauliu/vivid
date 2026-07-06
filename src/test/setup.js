// Extends Vitest's `expect` with DOM matchers (toBeInTheDocument, toHaveTextContent…).
import '@testing-library/jest-dom/vitest';

// Node 22+ exposes a disabled experimental `localStorage` global that shadows
// jsdom's, leaving `localStorage` undefined under Vitest. Install a small
// in-memory implementation so storage-backed code (usePersistentState, theme,
// sync config) behaves the same as in the browser.
class MemoryStorage {
  #map = new Map();
  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }
  setItem(key, value) {
    this.#map.set(String(key), String(value));
  }
  removeItem(key) {
    this.#map.delete(String(key));
  }
  clear() {
    this.#map.clear();
  }
  key(i) {
    return [...this.#map.keys()][i] ?? null;
  }
  get length() {
    return this.#map.size;
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});
