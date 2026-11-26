'use strict';
const { DateTime } = require('luxon');

/** DateTime theo múi giờ cơ sở */
const local = (d, tz) => DateTime.fromJSDate(d instanceof Date ? d : new Date(d)).setZone(tz);

const minutesBetween = (a, b) => Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);

/** Chuỗi YYYY-MM-DD → DateTime đầu ngày theo tz */
const dayStart = (dateStr, tz) => DateTime.fromISO(dateStr, { zone: tz }).startOf('day');

/**
 * Ngày làm việc (business day) mà thời điểm d thuộc về, có tính giờ chốt ngày.
 * dayCloseMin = 0 → nửa đêm. 120 → lượt lúc 01:30 tính vào hôm trước.
 */
function bizDate(d, tz, dayCloseMin = 0) {
  return local(d, tz).minus({ minutes: dayCloseMin }).toISODate();
}

/** Khoảng [start, end) thực của một ngày làm việc */
function bizDayRange(dateStr, tz, dayCloseMin = 0) {
  const s = dayStart(dateStr, tz).plus({ minutes: dayCloseMin });
  return { start: s.toJSDate(), end: s.plus({ days: 1 }).toJSDate() };
}

/** Khoảng from..to theo ngày (YYYY-MM-DD, bao gồm cả ngày to) */
function dateRange(from, to, tz, dayCloseMin = 0) {
  return {
    start: bizDayRange(from, tz, dayCloseMin).start,
    end: bizDayRange(to, tz, dayCloseMin).end,
  };
}

/** Parse tham số from/to: chấp nhận YYYY-MM-DD hoặc datetime ISO */
function parseRangeParams(q, tz, dayCloseMin, defDays = 0) {
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const today = bizDate(new Date(), tz, dayCloseMin);
  let start; let end;
  if (q.from) start = isDate(q.from) ? bizDayRange(q.from, tz, dayCloseMin).start : new Date(q.from);
  else start = bizDayRange(DateTime.fromISO(today).minus({ days: defDays }).toISODate(), tz, dayCloseMin).start;
  if (q.to) end = isDate(q.to) ? bizDayRange(q.to, tz, dayCloseMin).end : new Date(q.to);
  else end = bizDayRange(today, tz, dayCloseMin).end;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

module.exports = { DateTime, local, minutesBetween, dayStart, bizDate, bizDayRange, dateRange, parseRangeParams };
