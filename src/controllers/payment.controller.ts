import { Request, Response } from 'express';
import { razorpayService } from '../services/razorpay.service';
import { validatePackagePricing, checkForDowngrade } from '../utils/packageUtils';

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

      // Validate package pricing against configured packages
      const validation = validatePackagePricing(packageName, amount, packageDuration);
      
      if (!validation.isValid) {
        return res.status(400).json({ 
          error: validation.error,
          expectedAmount: validation.expectedAmount
        });
      }

      // Check if the user is trying to downgrade from a higher active plan
      const downgradeCheck = await checkForDowngrade(user.userId, packageName);
      
      if (downgradeCheck.isDowngrade) {
        return res.status(400).json({ 
          error: downgradeCheck.error,
          currentPackage: downgradeCheck.currentPackage
        });
      }

      const order = await razorpayService.createOrder(amount, user.userId, packageName, packageDuration, currency);
      res.json(order);
    } catch (error) {
      console.error('Error creating order:', error);
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
        // Fetch the updated payment record to get card information
        const payment = await razorpayService.getPaymentDetails(orderId);
        
        res.json({ 
          status: 'success', 
          message: 'Payment verified successfully',
          payment: {
            id: payment.id,
            orderId: payment.orderId,
            paymentId: payment.paymentId,
            amount: payment.amount,
            currency: payment.currency,
            status: payment.status,
            lastFourDigits: payment.lastFourDigits,
            cardType: payment.cardType,
            createdAt: payment.createdAt
          }
        });
      } else {
        res.status(400).json({ status: 'error', message: 'Payment verification failed' });
      }
    } catch (error) {
      console.error('Error verifying payment:', error);
      res.status(500).json({ error: 'Error verifying payment' });
    }
  },

  async getPaymentHistory(req: Request, res: Response) {
    try {
      const user = req.user as { userId: number };
      const { page = "1", limit = "10" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

      const payments = await razorpayService.getPaymentHistory(user.userId, skip, parseInt(limit as string));
      const totalPayments = await razorpayService.getPaymentCount(user.userId);

      res.json({
        success: true,
        data: payments,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: totalPayments,
          totalPages: Math.ceil(totalPayments / parseInt(limit as string))
        }
      });
    } catch (error) {
      console.error('Error fetching payment history:', error);
      res.status(500).json({ error: 'Error fetching payment history' });
    }
  }
}; 