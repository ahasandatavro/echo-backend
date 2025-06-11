import Razorpay from 'razorpay';
import crypto from 'crypto';
import { prisma } from '../models/prismaClient';

class RazorpayService {
  private razorpay: Razorpay;

  constructor() {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_ID,
      key_secret: process.env.RAZORPAY_SECRET,
    });
  }

  async createOrder(amount: number, userId: number, packageName: string, currency: string = 'INR') {
    try {
      const options = {
        amount: amount * 100, // amount in smallest currency unit (paise for INR)
        currency,
        receipt: `receipt_${Date.now()}`,
      };

      const order = await this.razorpay.orders.create(options);

      // Store order in database
      await prisma.payment.create({
        data: {
          userId,
          orderId: order.id,
          amount: amount,
          currency,
          packageName,
          status: 'PENDING'
        }
      });

      return order;
    } catch (error) {
      throw new Error(`Error creating Razorpay order: ${error}`);
    }
  }

  async verifyPayment(paymentId: string, orderId: string, signature: string) {
    try {
      const body = `${orderId}|${paymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_SECRET || '')
        .update(body)
        .digest('hex');

      const isValid = expectedSignature === signature;

      if (isValid) {
        // Update payment status in database
        await prisma.payment.update({
          where: { orderId },
          data: {
            paymentId,
            signature,
            status: 'SUCCESS'
          }
        });
      } else {
        // Update payment status to failed
        await prisma.payment.update({
          where: { orderId },
          data: {
            paymentId,
            signature,
            status: 'FAILED'
          }
        });
      }

      return isValid;
    } catch (error) {
      throw new Error(`Error verifying payment: ${error}`);
    }
  }
}

export const razorpayService = new RazorpayService();
