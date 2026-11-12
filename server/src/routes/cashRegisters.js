import { Router } from 'express';
import * as cashRegisters from '../services/cashRegisterService.js';
import { asyncHandler } from '../utils/httpError.js';

const router = Router();

router.get('/current', asyncHandler(async (_req, res) => res.json(await cashRegisters.getCurrent())));
router.post('/open', asyncHandler(async (req, res) => res.status(201).json(await cashRegisters.open(req.body.initial_amount))));
router.post('/close', asyncHandler(async (req, res) => res.json(await cashRegisters.close(req.body.final_amount))));

export default router;
