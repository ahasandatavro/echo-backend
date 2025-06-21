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

  async createOrder(amount: number, userId: number, packageName: string, packageDuration: 'monthly' | 'yearly', currency: string = 'INR') {
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
          paymentType: 'upgrade-package',
          metadata: {
            packageName,
            packageDuration
          },
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
        // Fetch payment details from Razorpay to get card information
        let lastFourDigits: string | null = null;
        let cardType: string | null = null;

        try {
          const paymentDetails = await this.razorpay.payments.fetch(paymentId);
          
          // Extract card information from payment method
          if (paymentDetails.method === 'card' && paymentDetails.card) {
            lastFourDigits = paymentDetails.card.last4;
            cardType = paymentDetails.card.network?.toLowerCase() || null;
          } else if (paymentDetails.method === 'upi' && paymentDetails.vpa) {
            // For UPI, we can store the VPA (Virtual Payment Address)
            lastFourDigits = paymentDetails.vpa.slice(-4);
            cardType = 'upi';
          } else if (paymentDetails.method === 'netbanking' && paymentDetails.bank) {
            // For netbanking, we can store bank code
            lastFourDigits = paymentDetails.bank.toString().slice(-4);
            cardType = 'netbanking';
          } else if (paymentDetails.method === 'wallet' && paymentDetails.wallet) {
            // For wallet payments
            lastFourDigits = paymentDetails.wallet.slice(-4);
            cardType = 'wallet';
          }
        } catch (error) {
          console.error('Error fetching payment details from Razorpay:', error);
          // Continue with payment verification even if we can't fetch card details
        }

        // Get payment details to create package subscription
        const payment = await prisma.payment.findUnique({
          where: { orderId },
          select: {
            id: true,
            userId: true,
            metadata: true
          }
        });

        if (payment) {
          const metadata = payment.metadata as { packageName: string; packageDuration: 'monthly' | 'yearly' };
          const startDate = new Date();
          const endDate = new Date(startDate);
          endDate.setMonth(endDate.getMonth() + (metadata.packageDuration === 'yearly' ? 12 : 1));

          await prisma.$transaction([
            // Update payment status with card information
            prisma.payment.update({
              where: { orderId },
              data: {
                paymentId,
                signature,
                status: 'SUCCESS',
                lastFourDigits,
                cardType
              }
            }),
            // Deactivate previous subscriptions
            prisma.packageSubscription.updateMany({
              where: {
                userId: payment.userId,
                isActive: true
              },
              data: {
                isActive: false
              }
            }),
            // Create new subscription
            prisma.packageSubscription.create({
              data: {
                userId: payment.userId,
                paymentId: payment.id,
                packageName: metadata.packageName,
                startDate,
                endDate,
                isActive: true
              }
            })
          ]);
        }
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

  async getPaymentDetails(orderId: string) {
    try {
      const payment = await prisma.payment.findUnique({
        where: { orderId },
        select: {
          id: true,
          orderId: true,
          paymentId: true,
          amount: true,
          currency: true,
          status: true,
          lastFourDigits: true,
          cardType: true,
          createdAt: true
        }
      });

      if (!payment) {
        throw new Error('Payment not found');
      }

      return payment;
    } catch (error) {
      throw new Error(`Error fetching payment details: ${error}`);
    }
  }

  async getPaymentHistory(userId: number, skip: number, limit: number) {
    try {
      const payments = await prisma.payment.findMany({
        where: { userId },
        select: {
          id: true,
          orderId: true,
          paymentId: true,
          amount: true,
          currency: true,
          status: true,
          paymentType: true,
          lastFourDigits: true,
          cardType: true,
          createdAt: true,
          metadata: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      });

      return payments;
    } catch (error) {
      throw new Error(`Error fetching payment history: ${error}`);
    }
  }

  async getPaymentCount(userId: number) {
    try {
      const count = await prisma.payment.count({
        where: { userId }
      });

      return count;
    } catch (error) {
      throw new Error(`Error counting payments: ${error}`);
    }
  }
}

export const razorpayService = new RazorpayService();
