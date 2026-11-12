import { Router } from 'express';
import * as tickets from '../services/ticketService.js';
import { retryRejected } from '../services/verifactiService.js';
import { asyncHandler } from '../utils/httpError.js';

const router = Router();

router.get('/open', asyncHandler(async (_req, res) => res.json(await tickets.listOpen())));
router.get('/:id', asyncHandler(async (req, res) => res.json(await tickets.getTicket(req.params.id))));
router.post('/', asyncHandler(async (req, res) => res.status(201).json(await tickets.createTicket(req.body))));
router.post('/:id/payments', asyncHandler(async (req, res) => res.json(await tickets.addPayments(req.params.id, req.body.payments))));
router.post('/:id/verifacti/retry', asyncHandler(async (req, res) => {
  await retryRejected(req.params.id);
  res.json(await tickets.getTicket(req.params.id));
}));

export default router;
