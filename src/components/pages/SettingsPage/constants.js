import { Settings, Palette, Search, Sparkles, Info } from 'lucide-react';

export const TABS = [
  { id: 'general', labelKey: 'settings.tabs.general', icon: Settings },
  { id: 'appearance', labelKey: 'settings.tabs.appearance', icon: Palette },
  { id: 'library', labelKey: 'settings.tabs.library', icon: Search },
  { id: 'ai', labelKey: 'settings.tabs.ai', icon: Sparkles },
  { id: 'about', labelKey: 'settings.tabs.about', icon: Info },
];

export const LANGUAGES = [
  { value: '', labelKey: 'settings.appearance.systemDefault' },
  { value: 'zh-CN', labelKey: 'settings.appearance.languages.zhCN' },
  { value: 'zh-TW', labelKey: 'settings.appearance.languages.zhTW' },
  { value: 'en', labelKey: 'settings.appearance.languages.en' },
  { value: 'fr', labelKey: 'settings.appearance.languages.fr' },
  { value: 'de', labelKey: 'settings.appearance.languages.de' },
  { value: 'hi', labelKey: 'settings.appearance.languages.hi' },
  { value: 'ja', labelKey: 'settings.appearance.languages.ja' },
  { value: 'ko', labelKey: 'settings.appearance.languages.ko' },
  { value: 'pt', labelKey: 'settings.appearance.languages.pt' },
  { value: 'es', labelKey: 'settings.appearance.languages.es' },
  { value: 'vi', labelKey: 'settings.appearance.languages.vi' },
];

export const HOME_PAGE_OPTIONS = [
  { value: 'all', labelKey: 'settings.homePageOptions.all' },
  { value: 'image', labelKey: 'settings.homePageOptions.image' },
  { value: 'video', labelKey: 'settings.homePageOptions.video' },
  { value: 'audio', labelKey: 'settings.homePageOptions.audio' },
  { value: 'folders', labelKey: 'settings.homePageOptions.folders' },
  { value: 'albums', labelKey: 'settings.homePageOptions.albums' },
  { value: 'music', labelKey: 'settings.homePageOptions.music' },
];

export const RETENTION_OPTIONS = [7, 14, 30, 60, 90];

export const COLOR_THEMES = [
  { value: 'blue', labelKey: 'settings.colorThemes.ocean', color: '#1d7af0' },
  { value: 'indigo', labelKey: 'settings.colorThemes.indigo', color: '#6366f1' },
  { value: 'purple', labelKey: 'settings.colorThemes.purple', color: '#a855f7' },
  { value: 'pink', labelKey: 'settings.colorThemes.pink', color: '#ec4899' },
  { value: 'rose', labelKey: 'settings.colorThemes.rose', color: '#f43f5e' },
  { value: 'red', labelKey: 'settings.colorThemes.red', color: '#ef4444' },
  { value: 'orange', labelKey: 'settings.colorThemes.sunset', color: '#f97316' },
  { value: 'amber', labelKey: 'settings.colorThemes.amber', color: '#d97706' },
  { value: 'gold', labelKey: 'settings.colorThemes.gold', color: '#eab308' },
  { value: 'lime', labelKey: 'settings.colorThemes.lime', color: '#84cc16' },
  { value: 'green', labelKey: 'settings.colorThemes.forest', color: '#22c55e' },
  { value: 'teal', labelKey: 'settings.colorThemes.teal', color: '#14b8a6' },
  { value: 'cyan', labelKey: 'settings.colorThemes.cyan', color: '#06b6d4' },
  { value: 'slate', labelKey: 'settings.colorThemes.slate', color: '#64748b' },
];
