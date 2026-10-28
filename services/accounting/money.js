// The books hold whole paisa (1 taka = 100 paisa), so adding and splitting amounts never drifts. The dashboard works in
// taka, with up to two decimals. These two functions are the only place where the two meet.
const toMinor = (taka) => Math.round((Number(taka) || 0) * 100);
const fromMinor = (minor) => (Number(minor) || 0) / 100;

module.exports = { toMinor, fromMinor };
