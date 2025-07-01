// controllers/webhookController.js
import { prisma } from '../models/prismaClient';
import { Request, Response } from "express";
import { checkWebhookLimit } from '../utils/packageUtils';

// Helper function to fetch user and phone number details
const getUserAndPhoneNumberDetails = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: parseInt(userId) },
  });
  const phoneNumberDetails = await prisma.businessPhoneNumber.findFirst({
    where: { metaPhoneNumberId: user?.selectedPhoneNumberId || "" },
  });
  return { user, phoneNumberDetails };
};

export const createWebhook = async (req: Request, res: Response) => {
  const { url, status, eventTypes } = req.body;

  const reqUser: any = req.user; // Ensure the user is authenticated and the user ID is available
  const userId = reqUser.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized: User not authenticated" });
  }

  // Fetch the user and phone number details using the helper function
  const { user, phoneNumberDetails } = await getUserAndPhoneNumberDetails(userId);

  if (!phoneNumberDetails) {
    return res.status(400).json({ message: "No business phone number found for this user" });
  }

  // Check webhook limit before creating
  const limitCheck = await checkWebhookLimit(userId, phoneNumberDetails.id, 1);
  if (!limitCheck.allowed) {
    return res.status(403).json({ 
      error: "Webhook limit exceeded",
      message: limitCheck.message,
      currentCount: limitCheck.currentCount,
      maxAllowed: limitCheck.maxAllowed,
      packageName: limitCheck.packageName
    });
  }

  try {
    const webhook = await prisma.webhook.create({
      data: {
        url,
        status,
        eventTypes,
        businessPhoneNumberId: phoneNumberDetails.id,
      },
    });
    return res.status(201).json({message:"Webhook created successfully"});
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create webhook' });
  }
};

export const getWebhooks = async (req: Request, res: Response) => {
  const reqUser: any = req.user; // Ensure the user is authenticated and the user ID is available
  const userId = reqUser.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized: User not authenticated" });
  }

  // Fetch the user and phone number details using the helper function
  const { phoneNumberDetails } = await getUserAndPhoneNumberDetails(userId);

  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        businessPhoneNumberId: phoneNumberDetails?.id || 0, // Use the ID from phoneNumberDetails
      },
      include: {
        businessPhoneNumber: true, // Include related phone number details if needed
      },
    });
    return res.status(200).json(webhooks);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
};

// Get a single webhook by ID
export const getWebhookById = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const webhook = await prisma.webhook.findUnique({
      where: {
        id: parseInt(id),
      },
      include: {
        businessPhoneNumber: true,
      },
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    return res.status(200).json(webhook);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch webhook' });
  }
};

// Update a webhook
export const updateWebhook = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { url, status, eventTypes } = req.body;

  try {
    const webhook = await prisma.webhook.update({
      where: {
        id: parseInt(id),
      },
      data: {
        url,
        status,
        eventTypes,
      },
    });
    return res.status(200).json(webhook);
  } catch (error) {
    console.error(error);
    if (error instanceof Error && 'code' in error && error.code === 'P2025') {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    return res.status(500).json({ error: 'Failed to update webhook' });
  }
};

// Delete a webhook
export const deleteWebhook = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await prisma.webhook.delete({
      where: {
        id: parseInt(id),
      },
    });
    return res.status(204).send(); // No content response for successful deletion
  } catch (error) {
    console.error(error);
    if (error instanceof Error && 'code' in error && error.code === 'P2025') {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    return res.status(500).json({ error: 'Failed to delete webhook' });
  }
};

// Get webhook logs for the active business phone number
export const getWebhookLogs = async (req: Request, res: Response) => {
  const reqUser: any = req.user;
  const userId = reqUser.userId;
  
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized: User not authenticated" });
  }

  try {
    // Get user's active business phone number
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { selectedPhoneNumberId: true }
    });

    if (!user?.selectedPhoneNumberId) {
      return res.status(400).json({ message: "No active business phone number found" });
    }

    // Get business phone number details
    const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: user.selectedPhoneNumberId }
    });

    if (!businessPhoneNumber) {
      return res.status(404).json({ message: "Business phone number not found" });
    }

    // Parse query parameters for pagination and filtering
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const status = req.query.status as string;
    const eventType = req.query.eventType as string;
    const webhookId = req.query.webhookId ? parseInt(req.query.webhookId as string) : undefined;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const skip = (page - 1) * limit;

    // Build where clause
    const whereClause: any = {
      businessPhoneNumberId: businessPhoneNumber.id
    };

    if (status) {
      whereClause.status = status;
    }

    if (eventType) {
      whereClause.eventType = eventType;
    }

    if (webhookId) {
      whereClause.webhookId = webhookId;
    }

    // Add time range filtering
    if (startDate || endDate) {
      whereClause.createdAt = {};
      
      if (startDate) {
        whereClause.createdAt.gte = new Date(startDate);
      }
      
      if (endDate) {
        whereClause.createdAt.lte = new Date(endDate);
      }
    }

    // Get webhook logs with pagination
    const [logs, totalCount] = await Promise.all([
      prisma.webhookLog.findMany({
        where: whereClause,
        include: {
          webhook: {
            select: {
              id: true,
              url: true,
              eventTypes: true,
              status: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: limit
      }),
      prisma.webhookLog.count({
        where: whereClause
      })
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return res.status(200).json({
      logs,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNextPage,
        hasPreviousPage,
        limit
      },
      filters: {
        status,
        eventType,
        webhookId,
        startDate,
        endDate
      }
    });

  } catch (error) {
    console.error('Error fetching webhook logs:', error);
    return res.status(500).json({ error: 'Failed to fetch webhook logs' });
  }
};

// Get webhook log statistics for the active business phone number
export const getWebhookLogStats = async (req: Request, res: Response) => {
  const reqUser: any = req.user;
  const userId = reqUser.userId;
  
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized: User not authenticated" });
  }

  try {
    // Get user's active business phone number
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { selectedPhoneNumberId: true }
    });

    if (!user?.selectedPhoneNumberId) {
      return res.status(400).json({ message: "No active business phone number found" });
    }

    // Get business phone number details
    const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: user.selectedPhoneNumberId }
    });

    if (!businessPhoneNumber) {
      return res.status(404).json({ message: "Business phone number not found" });
    }

    // Parse time range parameters
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    // Build base where clause
    const baseWhereClause: any = {
      businessPhoneNumberId: businessPhoneNumber.id
    };

    // Add time range filtering if provided
    if (startDate || endDate) {
      baseWhereClause.createdAt = {};
      
      if (startDate) {
        baseWhereClause.createdAt.gte = new Date(startDate);
      }
      
      if (endDate) {
        baseWhereClause.createdAt.lte = new Date(endDate);
      }
    }

    // Get statistics
    const [
      totalLogs,
      successCount,
      failedCount,
      pendingCount,
      avgResponseTime,
      recentLogs
    ] = await Promise.all([
      // Total logs
      prisma.webhookLog.count({
        where: baseWhereClause
      }),
      // Success count
      prisma.webhookLog.count({
        where: { 
          ...baseWhereClause,
          status: 'SUCCESS'
        }
      }),
      // Failed count
      prisma.webhookLog.count({
        where: { 
          ...baseWhereClause,
          status: { in: ['FAILED', 'MAX_RETRIES_EXCEEDED'] }
        }
      }),
      // Pending count
      prisma.webhookLog.count({
        where: { 
          ...baseWhereClause,
          status: { in: ['PENDING', 'RETRYING'] }
        }
      }),
      // Average response time
      prisma.webhookLog.aggregate({
        where: { 
          ...baseWhereClause,
          responseTime: { not: null }
        },
        _avg: {
          responseTime: true
        }
      }),
      // Recent logs (last 24 hours) - only if no time range is specified
      startDate || endDate ? Promise.resolve(0) : prisma.webhookLog.count({
        where: { 
          businessPhoneNumberId: businessPhoneNumber.id,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        }
      })
    ]);

    return res.status(200).json({
      stats: {
        total: totalLogs,
        success: successCount,
        failed: failedCount,
        pending: pendingCount,
        successRate: totalLogs > 0 ? ((successCount / totalLogs) * 100).toFixed(2) : '0',
        avgResponseTime: avgResponseTime._avg.responseTime || 0,
        recent24h: recentLogs
      },
      timeRange: {
        startDate,
        endDate
      }
    });

  } catch (error) {
    console.error('Error fetching webhook log stats:', error);
    return res.status(500).json({ error: 'Failed to fetch webhook log statistics' });
  }
};