const requested = new URLSearchParams(location.search).get('venue');
const valid = (value: string | null): value is string =>
  !!value && /^[A-Za-z0-9_-]{1,100}$/.test(value);
if (valid(requested)) sessionStorage.setItem('alfa-venue', requested);
export const venueId = valid(requested)
  ? requested
  : sessionStorage.getItem('alfa-venue') || 'demo';
const helpRole =
  location.pathname === '/help' ? new URLSearchParams(location.search).get('from') : null;
export const staffPage =
  /^\/(manager|waiter)(\/|$)/.test(location.pathname) ||
  location.pathname === '/bank' ||
  helpRole === 'manager' ||
  helpRole === 'waiter';
export const venueUrl = (path: string) => {
  const url = new URL(path, location.origin);
  url.searchParams.set('venue', venueId);
  return url.pathname + url.search + url.hash;
};
