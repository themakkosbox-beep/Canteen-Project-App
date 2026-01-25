const ADMIN_CODE_KEY = 'canteen_admin_code';

export const getAdminCode = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.sessionStorage.getItem(ADMIN_CODE_KEY);
  if (!stored || stored.trim().length === 0) {
    return null;
  }
  return stored.trim();
};

export const setAdminCode = (value: string | null | undefined): void => {
  if (typeof window === 'undefined') {
    return;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    window.sessionStorage.setItem(ADMIN_CODE_KEY, value.trim());
  } else {
    window.sessionStorage.removeItem(ADMIN_CODE_KEY);
  }
};
