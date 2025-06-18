import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller';
import { authenticateJWTWithoutSubscription } from '../middlewares/authMiddleware';

const router = Router();

router.post('/create-order', authenticateJWTWithoutSubscription, paymentController.createOrder);
router.post('/verify-payment', authenticateJWTWithoutSubscription, paymentController.verifyPayment);

export default router; 