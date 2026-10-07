const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));
const env = require('../config/env');

// Every membership date is worked out in the business time zone (APP_TIMEZONE, Asia/Dhaka by default), never in
// server UTC. Otherwise a record made between 12:00 am and 6:00 am Dhaka time lands on the previous day.
const TZ = env.timezone;
const DAY_MS = 86400000;

const inZone = (date) => dayjs(date).tz(TZ);
const today = (now = new Date()) => inZone(now).startOf('day');

// "2026-10-07" is the start of that day in the business time zone.
const parseDay = (text) => dayjs.tz(text, TZ).startOf('day');

// The start day counts as day 1: a 15-day plan starting 1 Oct ends at the end of 15 Oct. The duration is added
// first (a date library clamps month ends: 31 Jan plus 1 month is 28 Feb), then one day is taken off, and the
// time is set to 23:59:59.999 in the business time zone.
const calcEndDate = (start, { durationValue, durationUnit }) =>
  inZone(start).add(durationValue, durationUnit).subtract(1, 'day').endOf('day').toDate();

// Extending adds whole days to the current end and keeps the 23:59:59.999 time.
const addDays = (end, days) => inZone(end).add(days, 'day').endOf('day').toDate();

// Whole days left, counted up: 3.2 days left is 4. Negative once the end has passed.
const daysLeft = (end, now = new Date()) => Math.ceil((new Date(end) - now) / DAY_MS);

const monthRange = (month) => ({ from: month.startOf('month').toDate(), to: month.endOf('month').toDate() });
const ymd = (d) => d.format('YYYY-MM-DD');

module.exports = { TZ, DAY_MS, dayjs, inZone, today, parseDay, calcEndDate, addDays, daysLeft, monthRange, ymd };
