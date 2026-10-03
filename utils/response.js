// Every successful response goes through here so the envelope stays uniform:
// { success, message, data?, meta? }
const sendResponse = (res, statusCode, success, message, data = null, meta = null) => {
  const responseObj = { success, message };
  if (data !== null) responseObj.data = data;
  if (meta !== null) responseObj.meta = meta;
  return res.status(statusCode).json(responseObj);
};

module.exports = sendResponse;
