import { Request, Response } from 'express';
import { razorpayService } from '../services/razorpay.service';

export const paymentController = {
  async createOrder(req: Request, res: Response) {
    try {
      const { amount, currency, packageName } = req.body;
      const user = req.user as { userId: number };

      if (!amount || !packageName) {
        return res.status(400).json({ error: 'Amount and package name are required' });
      }

      const order = await razorpayService.createOrder(amount, user.userId, packageName, currency);
      res.json(order);
    } catch (error) {
      res.status(500).json({ error: 'Error creating order' });
    }
  },

  async verifyPayment(req: Request, res: Response) {
    try {
      const { paymentId, orderId, signature } = req.body;

      if (!paymentId || !orderId || !signature) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      const isValid = await razorpayService.verifyPayment(paymentId, orderId, signature);
      
      if (isValid) {
        // Here you can add logic to update your database with payment status
        res.json({ status: 'success', message: 'Payment verified successfully' });
      } else {
        res.status(400).json({ status: 'error', message: 'Payment verification failed' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Error verifying payment' });
    }
  }
}; 