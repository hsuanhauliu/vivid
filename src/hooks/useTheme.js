import { useEffect } from 'react';
import usePersistentState from './usePersistentState';

/**
 * Light/dark theme and accent color, persisted to localStorage and reflected
 * onto <html> via data-theme / data-color attributes. 'blue' is the default
 * accent and carries no data-color attribute (the base stylesheet).
 */
export default function useTheme() {
  const [theme, setTheme] = usePersistentState('vivid-theme', 'dark');
  const [colorTheme, setColorTheme] = usePersistentState('vivid-color-theme', 'blue');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (colorTheme === 'blue') document.documentElement.removeAttribute('data-color');
    else document.documentElement.setAttribute('data-color', colorTheme);
  }, [colorTheme]);

  return { theme, setTheme, colorTheme, setColorTheme };
}
