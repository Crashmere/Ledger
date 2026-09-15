const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
export function beijingDate(time = Date.now()): string { return formatter.format(time); }
export function dateEpoch(date: string): number { return Date.parse(date + 'T00:00:00+08:00'); }
export function shiftDay(date: string, days: number): string { return beijingDate(dateEpoch(date) + days * 86400000); }
export function dayLabel(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  return month + '月' + day + '日 · ' + (date === beijingDate() ? '今天' : ['周日','周一','周二','周三','周四','周五','周六'][weekday]);
}
