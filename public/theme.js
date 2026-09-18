(() => {
  const storageKey = 'trueplanner-theme';
  const root = document.documentElement;

  function getStoredTheme() {
    try {
      return localStorage.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    root.classList.toggle('dark', isDark);
    root.dataset.theme = isDark ? 'dark' : 'light';
  }

  applyTheme(getStoredTheme() === 'dark' ? 'dark' : 'light');

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('[data-theme-toggle]');
    if (!button) return;

    const updateButton = () => {
      const isDark = root.classList.contains('dark');
      button.textContent = isDark ? 'Light' : 'Dark';
      button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
      button.setAttribute('aria-pressed', String(isDark));
    };

    button.addEventListener('click', () => {
      const nextTheme = root.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(nextTheme);
      try {
        localStorage.setItem(storageKey, nextTheme);
      } catch (error) {
      }
      updateButton();
    });

    updateButton();
  });
})();
