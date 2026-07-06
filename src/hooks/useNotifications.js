import { useState, useCallback } from 'react';

const STORAGE_KEY = 'vivid-notifications';
const MAX = 200;

/**
 * System-message/notification state: persisted list, unread count, panel
 * visibility, and the push/mark-read/clear actions. Extracted from App so the
 * component doesn't carry the persistence bookkeeping inline.
 */
export default function useNotifications() {
  const [notifications, setNotifications] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [showNotifications, setShowNotifications] = useState(false);

  const push = useCallback((type, message) => {
    const now = Date.now();
    const note = {
      id: now + Math.random(),
      time: new Date().toISOString(),
      type,
      message,
      read: false,
    };
    setNotifications((prev) => {
      // Collapse duplicates: if the most recent notification is identical
      // (same type + message) and was pushed within the last 2s, drop this one.
      // Guards against any duplicate fan-out (e.g. multiple event listeners
      // firing for a single backend event) producing repeated toasts.
      const last = prev[0];
      if (
        last &&
        last.type === type &&
        last.message === message &&
        now - new Date(last.time).getTime() < 2000
      ) {
        return prev;
      }
      const updated = [note, ...prev].slice(0, MAX);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const markRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeOne = useCallback((id) => {
    setNotifications((prev) => {
      const updated = prev.filter((n) => n.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clear = useCallback(() => {
    setNotifications([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Success confirmations aren't surfaced (warnings/errors only), so they don't
  // count toward the unread badge either.
  const unreadCount = notifications.reduce(
    (n, x) => n + (x.read || x.type === 'success' ? 0 : 1),
    0,
  );

  return {
    notifications,
    unreadCount,
    showNotifications,
    setShowNotifications,
    push,
    markRead,
    removeOne,
    clear,
  };
}
