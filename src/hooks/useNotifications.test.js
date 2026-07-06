import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useNotifications from './useNotifications';

beforeEach(() => localStorage.clear());

describe('useNotifications', () => {
  it('pushes a notification', () => {
    const { result } = renderHook(() => useNotifications());
    act(() => result.current.push('info', 'hello'));
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].message).toBe('hello');
  });

  it('collapses identical notifications pushed in quick succession', () => {
    const { result } = renderHook(() => useNotifications());
    // Simulates multiple event listeners firing for one backend event.
    act(() => {
      result.current.push('warning', '2 unsupported file types');
      result.current.push('warning', '2 unsupported file types');
      result.current.push('warning', '2 unsupported file types');
      result.current.push('warning', '2 unsupported file types');
    });
    expect(result.current.notifications).toHaveLength(1);
  });

  it('keeps distinct messages', () => {
    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.push('info', 'first');
      result.current.push('info', 'second');
    });
    expect(result.current.notifications).toHaveLength(2);
  });

  it('removeOne drops a single notification by id', () => {
    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.push('info', 'a');
      result.current.push('info', 'b');
    });
    const targetId = result.current.notifications[0].id;
    act(() => result.current.removeOne(targetId));
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications.find((n) => n.id === targetId)).toBeUndefined();
  });

  it('unreadCount counts unread, markRead clears it', () => {
    const { result } = renderHook(() => useNotifications());
    act(() => result.current.push('info', 'x'));
    expect(result.current.unreadCount).toBe(1);
    act(() => result.current.markRead());
    expect(result.current.unreadCount).toBe(0);
  });
});
