const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));
const env = require('../../config/env');

// Accounting dates are plain days ("2026-10-26") in the business time zone (APP_TIMEZONE, Asia/Dhaka by default). A
// voucher made at 1 am Dhaka time belongs to that day, not to the day before in UTC.
const TZ = env.timezone;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((month) => month.slice(0, 3));

const parse = (day) => dayjs.tz(day, TZ).startOf('day');
// The business day of a moment in time.
const dayOf = (date) => dayjs(date).tz(TZ).format('YYYY-MM-DD');
const todayISO = () => dayjs().tz(TZ).format('YYYY-MM-DD');
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && parse(value).isValid() && parse(value).format('YYYY-MM-DD') === value;
const addDays = (day, days) => parse(day).add(days, 'day').format('YYYY-MM-DD');
// Whole days from `from` to `to` (positive when `to` is later).
const daysBetween = (from, to) => parse(to).diff(parse(from), 'day');
const daysInMonth = (year, monthIndex) => dayjs.tz(`${year}-${String(monthIndex + 1).padStart(2, '0')}-01`, TZ).daysInMonth();

// The first and last day of a month. The current month ends today, so "this month" never includes the future.
const monthWindow = (year, monthIndex, now = todayISO()) => {
  const first = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const last = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(daysInMonth(year, monthIndex)).padStart(2, '0')}`;
  return { from: first, to: now >= first && now < last ? now : last };
};

// The month and year of today.
const currentMonth = () => {
  const now = dayjs().tz(TZ);
  return { year: now.year(), month: now.month() };
};

module.exports = { dayOf, TZ, MONTHS, MONTHS_SHORT, parse, todayISO, isDay, addDays, daysBetween, daysInMonth, monthWindow, currentMonth };
