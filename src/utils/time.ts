import dayjs from 'dayjs';

export function formatUnixSeconds(ts: number | undefined | null): string {
  if (ts === undefined || ts === null || Number.isNaN(Number(ts))) return '—';
  return dayjs.unix(Number(ts)).format('YYYY-MM-DD HH:mm:ss');
}
