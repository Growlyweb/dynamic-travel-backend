// Makes user text safe to put inside a RegExp (search boxes must never act as patterns).
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = escapeRegex;
