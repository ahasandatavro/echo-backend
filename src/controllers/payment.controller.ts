import { Request, Response } from 'express';
import { razorpayService } from '../services/razorpay.service';

export const paymentController = {
  async createOrder(req: Request, res: Response) {
    try {
      const { amount, currency, packageName, packageDuration } = req.body;
      const user = req.user as { userId: number };

      if (!amount || !packageName || !packageDuration) {
        return res.status(400).json({ error: 'Amount, package name, and package duration are required' });
      }

      if (packageDuration !== 'monthly' && packageDuration !== 'yearly') {
        return res.status(400).json({ error: 'Package duration must be either monthly or yearly' });
      }

      const order = await razorpayService.createOrder(amount, user.userId, packageName, packageDuration, currency);
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