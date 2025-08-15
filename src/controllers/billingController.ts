import { Request, Response } from "express";
import { billingInformationValidation } from "../utils/joiSchemas";
import { prisma } from "../models/prismaClient";

// Get billing information for the authenticated user
export const getBillingInformation = async (req: Request, res: Response): Promise<void> => {
  try {
    const user: any = req.user;
    const userId = user.userId;

    const billingInfo = await prisma.billingInformation.findUnique({
      where: { userId },
    });

    // Fetch the latest successful payment for the user
    const latestPayment = await prisma.payment.findFirst({
      where: { 
        userId, 
        status: 'SUCCESS' 
      },
      orderBy: { 
        createdAt: 'desc' 
      },
      select: {
        lastFourDigits: true,
        cardType: true,
        createdAt: true,
        amount: true,
        currency: true,
        paymentType: true
      }
    });

    if (!billingInfo) {
      res.status(404).json({ error: "Billing information not found" });
      return;
    }

    res.json({
      success: true,
      data: billingInfo,
      latestPayment: latestPayment || null
    });
  } catch (error) {
    console.error("Error fetching billing information:", error);
    res.status(500).json({ error: "Error fetching billing information" });
  }
};

// Update or create billing information for the authenticated user
export const updateBillingInformation = async (req: Request, res: Response): Promise<void> => {
  try {
    const user: any = req.user;
    const userId = user.userId;

    const { email, firstName, lastName, company, countryCode, mobileNumber } = req.body;

    // Validate request body using Joi schema
    const { error } = billingInformationValidation.validate(req.body);
    if (error) {
      res.status(400).json({ 
        error: "Validation error", 
        details: error.details.map(detail => detail.message)
      });
      return;
    }

    // Check if billing information already exists for this user
    const existingBillingInfo = await prisma.billingInformation.findUnique({
      where: { userId },
    });

    let billingInfo;

    if (existingBillingInfo) {
      // Update existing billing information
      billingInfo = await prisma.billingInformation.update({
        where: { userId },
        data: {
          email,
          firstName,
          lastName,
          company,
          countryCode,
          mobileNumber,
        },
      });
    } else {
      // Create new billing information
      billingInfo = await prisma.billingInformation.create({
        data: {
          userId,
          email,
          firstName,
          lastName,
          company,
          countryCode,
          mobileNumber,
        },
      });
    }

    res.json({
      success: true,
      data: billingInfo,
      message: existingBillingInfo ? "Billing information updated successfully" : "Billing information created successfully",
    });
  } catch (error) {
    console.error("Error updating billing information:", error);
    res.status(500).json({ error: "Error updating billing information" });
  }
}; 