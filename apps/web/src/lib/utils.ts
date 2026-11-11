import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const number = (value: number | null, digits = 1) =>
  value === null
    ? '—'
    : value.toLocaleString('ru-RU', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
export const time = (value: string) => new Date(value).toLocaleTimeString('ru-RU');
export const dateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';
