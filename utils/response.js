// Every successful response goes through here so the envelope stays uniform:
// { success, message, data?, meta?, pagination? }
// On a list, `meta` and `pagination` carry the same object { total, page, limit, totalPages }. `meta` is the name
// this API has always used; `pagination` is the name the tour handoff asks for. Clients can read either.
const sendResponse = (res, statusCode, success, message, data = null, meta = null) => {
  const responseObj = { success, message };
  if (data !== null) responseObj.data = data;
  if (meta !== null) {
    responseObj.meta = meta;
    responseObj.pagination = meta;
  }
  return res.status(statusCode).json(responseObj);
};

module.exports = sendResponse;
