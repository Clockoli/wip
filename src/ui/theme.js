// Small presentation preference shared by extension pages; no credentials or work data.
(() => {
  const key = 'clockoli-theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let temporaryChoice = null;
  const read = () => {
    if (temporaryChoice) return temporaryChoice;
    try {
      const value = window.localStorage.getItem(key);
      return value === 'light' || value === 'dark' ? value : null;
    } catch { return null; }
  };
  const apply = () => {
    const current = read() || (media.matches ? 'dark' : 'light');
    document.documentElement.dataset.clockoliTheme = current;
    const control = document.querySelector('.page-theme-toggle');
    if (control) {
      const label = `Switch to ${current === 'dark' ? 'light' : 'dark'} theme`;
      control.setAttribute('aria-label', label);
      control.title = label;
    }
  };
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    const control = document.querySelector('.page-theme-toggle');
    control?.addEventListener('click', () => {
      const next = document.documentElement.dataset.clockoliTheme === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(key, next); } catch { temporaryChoice = next; }
      document.documentElement.dataset.clockoliTheme = next;
      apply();
    });
    apply();
  });
  media.addEventListener('change', () => { if (!read()) apply(); });
  window.addEventListener('storage', event => { if (event.key === key) apply(); });
})();
