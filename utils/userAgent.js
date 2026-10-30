/**
 * Parses user agent string into human-friendly device and browser labels.
 * Example output: "Chrome · Windows", "Safari · iPhone", "Firefox · Linux"
 */
function parseUserAgent(uaString = '') {
  if (!uaString || typeof uaString !== 'string') {
    return 'Unknown Device';
  }

  const ua = uaString;

  // Detect OS
  let os = 'Unknown OS';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/iphone/i.test(ua)) os = 'iPhone';
  else if (/ipad/i.test(ua)) os = 'iPad';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';

  // Detect Browser
  let browser = 'Browser';
  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/opr|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = 'Safari';
  else if (/postman/i.test(ua)) browser = 'Postman';
  else if (/curl/i.test(ua)) browser = 'cURL';

  return `${browser} · ${os}`;
}

module.exports = { parseUserAgent };
