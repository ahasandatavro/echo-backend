import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller';

const router = Router();

router.post('/create-order', paymentController.createOrder);
router.post('/verify-payment', paymentController.verifyPayment);

export default router; 