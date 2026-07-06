import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import usePersistentState, { boolDefaultTrue, boolDefaultFalse } from './usePersistentState';

beforeEach(() => localStorage.clear());

describe('usePersistentState', () => {
  it('uses the initial value when nothing is stored', () => {
    const { result } = renderHook(() => usePersistentState('k', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('reads an existing stored value on mount (via parse)', () => {
    localStorage.setItem('count', '42');
    const { result } = renderHook(() => usePersistentState('count', 0, Number));
    expect(result.current[0]).toBe(42);
  });

  it('writes back to localStorage on change (via serialize)', () => {
    const { result } = renderHook(() => usePersistentState('count', 0, Number, String));
    act(() => result.current[1](7));
    expect(result.current[0]).toBe(7);
    expect(localStorage.getItem('count')).toBe('7');
  });

  it('persists across separate hook instances', () => {
    const first = renderHook(() => usePersistentState('theme', 'light'));
    act(() => first.result.current[1]('dark'));
    const second = renderHook(() => usePersistentState('theme', 'light'));
    expect(second.result.current[0]).toBe('dark');
  });
});

describe('boolean parsers', () => {
  it('boolDefaultTrue treats only "false" as false', () => {
    expect(boolDefaultTrue('false')).toBe(false);
    expect(boolDefaultTrue('true')).toBe(true);
    expect(boolDefaultTrue('anything')).toBe(true);
  });
  it('boolDefaultFalse treats only "true" as true', () => {
    expect(boolDefaultFalse('true')).toBe(true);
    expect(boolDefaultFalse('false')).toBe(false);
    expect(boolDefaultFalse('')).toBe(false);
  });
});
