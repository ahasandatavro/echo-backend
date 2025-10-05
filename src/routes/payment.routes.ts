import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller';
import { authenticateJWTWithoutSubscription } from '../middlewares/authMiddleware';
import { validateRequest } from '../middlewares/errorHandler';
import { createOrderValidation, verifyPaymentValidation } from '../utils/joiSchemas';

const router = Router();

router.post('/create-order', 
  authenticateJWTWithoutSubscription, 
  validateRequest(createOrderValidation),
  paymentController.createOrder
);
router.post('/verify-payment', 
  authenticateJWTWithoutSubscription,
  validateRequest(verifyPaymentValidation),
  paymentController.verifyPayment
);

export default router; 