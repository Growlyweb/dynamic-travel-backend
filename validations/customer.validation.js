const { z } = require('zod');
const { USER_STATUS } = require('../config/constants');
const { idParam, pagination, search } = require('./common');

const listCustomers = z.object({
  ...pagination,
  search,
  status: z.enum(Object.values(USER_STATUS)).optional()
});

const updateCustomerStatus = z.object({
  status: z.enum([USER_STATUS.ACTIVE, USER_STATUS.SUSPENDED, USER_STATUS.BLOCKED, USER_STATUS.INACTIVE])
});

module.exports = {
  listCustomers,
  idParam,
  updateCustomerStatus
};
