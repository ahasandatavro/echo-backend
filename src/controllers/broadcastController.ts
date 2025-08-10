import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';
import { getBroadcastRecipientHistory, getBroadcastRecipientHistoryByContact } from '../subProcessors/metaWebhook';

export const getBroadcastHistory = async (req: Request, res: Response) => {
  try {
    const { broadcastId, contactId } = req.params;
    
    if (!broadcastId || !contactId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Broadcast ID and Contact ID are required' 
      });
    }

    const history = await getBroadcastRecipientHistoryByContact(
      parseInt(broadcastId), 
      parseInt(contactId)
    );

    if (!history) {
      return res.status(404).json({ 
        success: false, 
        message: 'Broadcast recipient not found' 
      });
    }

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error('Error fetching broadcast history:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getBroadcastRecipientById = async (req: Request, res: Response) => {
  try {
    const { recipientId } = req.params;
    
    if (!recipientId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Recipient ID is required' 
      });
    }

    const history = await getBroadcastRecipientHistory(parseInt(recipientId));

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error('Error fetching broadcast recipient history:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getAllBroadcasts = async (req: Request, res: Response) => {
  try {
    const broadcasts = await prisma.broadcast.findMany({
      include: {
        recipients: {
          include: {
            contact: true,
            history: {
              orderBy: { createdAt: 'desc' },
              take: 1, // Get only the latest status
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: broadcasts,
    });
  } catch (error) {
    console.error('Error fetching broadcasts:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getBroadcastById = async (req: Request, res: Response) => {
  try {
    const { broadcastId } = req.params;
    
    if (!broadcastId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Broadcast ID is required' 
      });
    }

    const broadcast = await prisma.broadcast.findUnique({
      where: { id: parseInt(broadcastId) },
      include: {
        recipients: {
          include: {
            contact: true,
            history: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!broadcast) {
      return res.status(404).json({ 
        success: false, 
        message: 'Broadcast not found' 
      });
    }

    return res.status(200).json({
      success: true,
      data: broadcast,
    });
  } catch (error) {
    console.error('Error fetching broadcast:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}; 