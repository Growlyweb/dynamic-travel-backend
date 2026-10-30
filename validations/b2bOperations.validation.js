const { z } = require('zod');
const { idParam, pagination, search } = require('./common');

const createPickup = z.object({
  location: z.string().trim().min(3).max(200),
  contactPerson: z.string().trim().min(2).max(100),
  contactPhone: z.string().trim().min(6).max(25),
  pickupAt: z.coerce.date(),
  travelers: z.coerce.number().int().min(1).default(1),
  notes: z.string().trim().max(500).optional().default('')
});

const updatePickupStatus = z.object({
  status: z.enum(['requested', 'scheduled', 'picked_up', 'delivered_to_hub', 'cancelled']).optional(),
  assignedStaff: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid staff ID').optional(),
  notes: z.string().trim().max(500).optional()
});

const createWithdrawal = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  method: z.enum(['Bank transfer', 'Wise', 'PayPal', 'bKash', 'Nagad', 'Cash']).default('Bank transfer'),
  accountDetails: z.string().trim().min(5).max(300)
});

const reviewWithdrawal = z.object({
  status: z.enum(['approved', 'rejected', 'paid']),
  adminNote: z.string().trim().max(500).optional().default(''),
  transactionReference: z.string().trim().max(100).optional().default('')
});

const listOperations = z.object({
  ...pagination,
  search,
  status: z.string().trim().optional(),
  partnerId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid partner ID').optional()
});

module.exports = {
  createPickup,
  updatePickupStatus,
  createWithdrawal,
  reviewWithdrawal,
  listOperations,
  idParam
};
