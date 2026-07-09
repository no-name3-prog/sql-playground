import { create } from 'zustand';
import type { Theme } from '../types';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const stored = (localStorage.getItem('sql-playground-theme') as Theme) || 'dark';

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: stored,
  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('sql-playground-theme', next);
    document.documentElement.setAttribute('data-theme', next);
    set({ theme: next });
  },
  setTheme: (t) => {
    localStorage.setItem('sql-playground-theme', t);
    document.documentElement.setAttribute('data-theme', t);
    set({ theme: t });
  },
}));

// apply on load
document.documentElement.setAttribute('data-theme', stored);
