import { Request, Response } from "express";
import { prisma } from "../models/prismaClient";
import axios from "axios";

export const createBusinessPhoneNumber = async (req: Request, res: Response) => {
  try {
    const { phoneNumber, businessAccountId, metaPhoneNumberId, displayName, connectionStatus, subscription } = req.body;

    const businessPhoneNumber = await prisma.businessPhoneNumber.create({
      data: {
        phoneNumber,
        businessAccountId: Number(businessAccountId),
        metaPhoneNumberId,
        displayName,
        connectionStatus,
        subscription,
      },
    });

    res.status(201).json(businessPhoneNumber);
  } catch (error) {
    console.error("Error creating business phone number:", error);
    res.status(500).json({ message: "Failed to create business phone number" });
  }
};

export const getBusinessPhoneNumberDetails = async (req: Request, res: Response) => {
  const user: any = req.user;
  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { selectedPhoneNumberId: true },
  });
  if (!dbUser?.selectedPhoneNumberId) {
    return res.status(400).json({ message: "No phone number selected for this user." });
  }
  const phoneNumber = await prisma.businessPhoneNumber.findUnique({
    where: { metaPhoneNumberId: dbUser.selectedPhoneNumberId },
    select: { phoneNumber: true, displayName: true, connectionStatus: true, subscription: true, updatedAt: true },
  });
  if (!phoneNumber) {
    return res.status(400).json({ message: "No phone number found for this user." });
  }
  res.status(200).json(phoneNumber);
}

export const getBusinessPhoneNumbers = async (req: Request, res: Response) => {
  try {
    const { businessAccountId } = req.query;

    const where = businessAccountId ? { businessAccountId: Number(businessAccountId) } : {};

    const phoneNumbers = await prisma.businessPhoneNumber.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(phoneNumbers);
  } catch (error) {
    console.error("Error fetching business phone numbers:", error);
    res.status(500).json({ message: "Failed to fetch business phone numbers" });
  }
};

export const getBusinessPhoneNumber = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const phoneNumber = await prisma.businessPhoneNumber.findUnique({
      where: { id: Number(id) },
    });

    if (!phoneNumber) {
      return res.status(404).json({ message: "Business phone number not found" });
    }

    res.status(200).json(phoneNumber);
  } catch (error) {
    console.error("Error fetching business phone number:", error);
    res.status(500).json({ message: "Failed to fetch business phone number" });
  }
};

export const updateBusinessPhoneNumber = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { phoneNumber, displayName, connectionStatus, subscription } = req.body;

    const updatedPhoneNumber = await prisma.businessPhoneNumber.update({
      where: { id: Number(id) },
      data: {
        phoneNumber,
        displayName,
        connectionStatus,
        subscription,
      },
    });

    res.status(200).json(updatedPhoneNumber);
  } catch (error) {
    console.error("Error updating business phone number:", error);
    res.status(500).json({ message: "Failed to update business phone number" });
  }
};

export const deleteBusinessPhoneNumber = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, selectedPhoneNumberId: true, selectedWabaId: true },
    });
    if (!dbUser?.id || !dbUser?.selectedPhoneNumberId) {
      return res.status(400).json({ message: "No phone number selected for this user." });
    }

    const { id } = req.params;
    const phoneNumberId = parseInt(id, 10);

    if (isNaN(phoneNumberId)) {
      return res.status(400).json({ message: "Invalid phone number ID" });
    }

    // First get the business phone number to get its metaPhoneNumberId
    const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: id },
      select: { metaPhoneNumberId: true,id:true }
    });

    if (!businessPhoneNumber) {
      return res.status(404).json({ message: "Business phone number not found" });
    }

    // Use a transaction to ensure all deletions are atomic
    await prisma.$transaction(async (tx) => {
      // 1. Delete all related webhooks
      await tx.webhook.deleteMany({
        where: { businessPhoneNumberId: businessPhoneNumber.id }
      });

      // 2. Delete default action settings
      await tx.defaultActionSettings.deleteMany({
        where: { businessPhoneNumberId: businessPhoneNumber.id }
      });

      // 3. Delete notification settings
      await tx.notificationSetting.deleteMany({
        where: { businessPhoneNumberId: businessPhoneNumber.id }
      });

       await tx.roundRobinState.deleteMany({
        where: { phoneNumberId: businessPhoneNumber.metaPhoneNumberId }
       });

      // 4. Handle conversations and their related data
      const conversations = await tx.conversation.findMany({
        where: { businessPhoneNumberId: businessPhoneNumber.id },
        select: { id: true }
      });

      const conversationIds = conversations.map(conv => conv.id);

      if (conversationIds.length > 0) {
        // Delete node visits related to conversations (must be done before deleting conversations due to foreign key constraint)
        await tx.nodeVisit.deleteMany({
          where: {
            conversationId: {
              in: conversationIds
            }
          }
        });

        // Delete variables related to conversations
        await tx.variable.deleteMany({
          where: {
            conversationId: {
              in: conversationIds
            }
          }
        });

        // Delete chat status history related to conversations
        await tx.chatStatusHistory.deleteMany({
          where: {
            conversationId: {
              in: conversationIds
            }
          }
        });

        // Delete messages related to conversations
        await tx.message.deleteMany({
          where: {
            conversationId: {
              in: conversationIds
            }
          }
        });
      }

      // Finally delete the conversations themselves
      await tx.conversation.deleteMany({
        where: { businessPhoneNumberId: businessPhoneNumber.id }
      });

      // 5. Delete all rules
      await tx.rule.deleteMany({
        where: { businessPhoneNumberId: businessPhoneNumber.id }
      });

      // 6. Handle reply materials and their related data
      const replyMaterials = await tx.replyMaterial.findMany({
        where: { businessPhoneNumberId: businessPhoneNumber.id },
        select: { id: true }
      });

      const replyMaterialIds = replyMaterials.map(rm => rm.id);

      if (replyMaterialIds.length > 0) {
        // Delete keyword reply material relations
        await tx.keywordReplyMaterial.deleteMany({
          where: {
            replyMaterialId: {
              in: replyMaterialIds
            }
          }
        });
      }

      // Delete the reply materials themselves
      await tx.replyMaterial.deleteMany({
        where: { businessPhoneNumberId: businessPhoneNumber.id }
      });

      // 7. Finally delete the business phone number itself
      await tx.businessPhoneNumber.delete({
        where: { id: businessPhoneNumber.id }
      });
    });

    // Update user's selected phone number and WABA ID if they match the deleted one
    if (dbUser.selectedPhoneNumberId === businessPhoneNumber.metaPhoneNumberId) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { 
          selectedPhoneNumberId: null,
          selectedWabaId: null 
        },
      });
    }

    res.status(200).json({ message: "Business phone number and all related data deleted successfully" });
  } catch (error) {
    console.error("Error deleting business phone number:", error);
    res.status(500).json({ message: "Failed to delete business phone number and related data" });
  }
};

export const updateFallbackSettings = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;

    // 1) Figure out which BusinessPhoneNumber the user has selected
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    });

    if (!dbUser?.selectedPhoneNumberId) {
      return res
        .status(400)
        .json({ message: "No phone number selected for this user." });
    }

    const metaId = dbUser.selectedPhoneNumberId;

    // 2) Find the record by its string metaPhoneNumberId
    const bp = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: metaId },
      select: { id: true },
    });

    if (!bp) {
      return res
        .status(404)
        .json({ message: `No BusinessPhoneNumber found for metaId=${metaId}` });
    }

    // 3) Pull the payload
    const { enabled, message, maxTriggers } = req.body as {
      enabled: boolean;
      message: string;
      maxTriggers: number;
    };

    // 4) Update by the numeric `id`
    const updated = await prisma.businessPhoneNumber.update({
      where: { id: bp.id },
      data: {
        fallbackEnabled: enabled,
        fallbackMessage: message,
        fallbackTriggerCount: maxTriggers,
      },
    });

    return res
      .status(200)
      .json({ message: "Fallback settings saved.", updated });
  } catch (err) {
    console.error("Error saving fallback settings:", err);
    return res
      .status(500)
      .json({ message: "Unable to save fallback settings." });
  }
};

export const getFallbackSettings = async (req: Request, res: Response) => {
  try {
    const userId = (req.user as any).userId;

    // 1) find which BusinessPhoneNumber this user has selected
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { selectedPhoneNumberId: true },
    });
    if (!dbUser?.selectedPhoneNumberId) {
      return res.status(400).json({ message: "No phone number selected." });
    }
const bp=await prisma.businessPhoneNumber.findFirst({
  where: { metaPhoneNumberId: dbUser.selectedPhoneNumberId },
  select: { id: true },
});
    // 2) load its fallback settings
    const phone = await prisma.businessPhoneNumber.findUnique({
      where: { id: bp?.id },
      select: {
        fallbackEnabled: true,
        fallbackMessage: true,
        fallbackTriggerCount: true,
      },
    });

    return res.json({
      enabled: phone?.fallbackEnabled ?? false,
      message: phone?.fallbackMessage ?? "",
      maxTriggers: phone?.fallbackTriggerCount ?? 0,
    });
  } catch (err) {
    console.error("GET fallback settings error:", err);
    return res.status(500).json({ message: "Failed to load fallback settings." });
  }
};

/**
 * Update timeout settings for the user's selected business phone number
 * @param req - Express request object containing timeout settings in body
 * @param res - Express response object
 * @returns JSON response with success message and updated data
 * 
 * Request body should contain:
 * - timeoutMinutes: number (default: 30)
 * - enableExitNotification: boolean (default: false)
 * - exitNotificationMessage: string (default: "Please type or select...")
 * - exitNotificationLeadTime: number (default: 5)
 */
export const updateTimeoutSettings = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;

    // 1) Figure out which BusinessPhoneNumber the user has selected
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    });

    if (!dbUser?.selectedPhoneNumberId) {
      return res
        .status(400)
        .json({ message: "No phone number selected for this user." });
    }

    const metaId = dbUser.selectedPhoneNumberId;

    // 2) Find the record by its string metaPhoneNumberId
    const bp = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: metaId },
      select: { id: true },
    });

    if (!bp) {
      return res
        .status(404)
        .json({ message: `No BusinessPhoneNumber found for metaId=${metaId}` });
    }

    // 3) Pull the payload
    const { timeoutMinutes, enableExitNotification, exitNotificationMessage, exitNotificationLeadTime } = req.body as {
      timeoutMinutes: number;
      enableExitNotification: boolean;
      exitNotificationMessage: string;
      exitNotificationLeadTime: number;
    };

    // 4) Update by the numeric `id`
    const updated = await prisma.businessPhoneNumber.update({
      where: { id: bp.id },
      data: {
        timeoutMinutes,
        enableExitNotification,
        exitNotificationMessage,
        exitNotificationLeadTime,
      },
    });

    return res
      .status(200)
      .json({ message: "Timeout settings saved.", updated });
  } catch (err) {
    console.error("Error saving timeout settings:", err);
    return res
      .status(500)
      .json({ message: "Unable to save timeout settings." });
  }
};

/**
 * Get timeout settings for the user's selected business phone number
 * @param req - Express request object
 * @param res - Express response object
 * @returns JSON response with current timeout settings
 * 
 * Returns:
 * - timeoutMinutes: number
 * - enableExitNotification: boolean
 * - exitNotificationMessage: string
 * - exitNotificationLeadTime: number
 */
export const getTimeoutSettings = async (req: Request, res: Response) => {
  try {
    const userId = (req.user as any).userId;

    // 1) find which BusinessPhoneNumber this user has selected
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { selectedPhoneNumberId: true },
    });
    if (!dbUser?.selectedPhoneNumberId) {
      return res.status(400).json({ message: "No phone number selected." });
    }
    
    const bp = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: dbUser.selectedPhoneNumberId },
      select: { id: true },
    });

    // 2) load its timeout settings
    const phone = await prisma.businessPhoneNumber.findUnique({
      where: { id: bp?.id },
      select: {
        timeoutMinutes: true,
        enableExitNotification: true,
        exitNotificationMessage: true,
        exitNotificationLeadTime: true,
      },
    });

    return res.json({
      timeoutMinutes: phone?.timeoutMinutes ?? 30,
      enableExitNotification: phone?.enableExitNotification ?? false,
      exitNotificationMessage: phone?.exitNotificationMessage ?? "Please type or select from the options above if you would like to continue, else this conversation will reset and you may have to share your responses again.",
      exitNotificationLeadTime: phone?.exitNotificationLeadTime ?? 5,
    });
  } catch (err) {
    console.error("GET timeout settings error:", err);
    return res.status(500).json({ message: "Failed to load timeout settings." });
  }
};

export const getMessagingAnalytics = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;

    // Get user's selected phone number and WABA ID
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { 
        selectedPhoneNumberId: true, 
        selectedWabaId: true 
      },
    });

    if (!dbUser?.selectedPhoneNumberId || !dbUser?.selectedWabaId) {
      return res.status(400).json({ 
        success: false,
        message: "No phone number or WABA ID selected for this user." 
      });
    }

    const selectedPhoneNumberId = dbUser.selectedPhoneNumberId;
    const selectedWabaId = dbUser.selectedWabaId;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!accessToken) {
      return res.status(500).json({ 
        success: false,
        message: "Meta access token not configured." 
      });
    }

    // 1. Get daily messaging limit from database first, then Meta API as fallback
    let dailyMessagingLimit = { current: 0, total: 250, percentage: 0 };
    
    // First, try to get the messaging limit tier from database
    const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: selectedPhoneNumberId },
      select: { id: true, messagingLimitTier: true }
    });

    if (!businessPhoneNumber) {
      return res.status(404).json({ 
        success: false,
        message: "Business phone number not found." 
      });
    }

    if (businessPhoneNumber.messagingLimitTier) {
      // Map the tier from database to actual limits
      const tierMapping: Record<string, number> = {
        'TIER_50': 50,
        'TIER_250': 250,
        'TIER_1K': 1000,
        'TIER_10K': 10000,
        'TIER_100K': 100000,
        'TIER_UNLIMITED': 999999
      };
      
      const totalLimit = tierMapping[businessPhoneNumber.messagingLimitTier] || 250;
      dailyMessagingLimit = {
        current: 0, // We don't track current usage in DB, so default to 0
        total: totalLimit,
        percentage: 0
      };
      
      console.log(`Using messaging limit from database: ${businessPhoneNumber.messagingLimitTier} (${totalLimit} messages)`);
    } else {
      // Fallback to Meta API if not found in database
      try {
        const limitResponse = await axios.get(
          `https://graph.facebook.com/v22.0/${selectedWabaId}/phone_numbers`,
          { 
            headers: { Authorization: `Bearer ${accessToken}` } 
          }
        );

        // Extract limit information from response
        if (limitResponse.data && limitResponse.data.data) {
          const phoneNumberData = limitResponse.data.data.find(
            (phone: any) => phone.id === selectedPhoneNumberId
          );
          
          if (phoneNumberData) {
            // Meta API might return limit info in different formats
            // For now, using default values and calculating percentage
            dailyMessagingLimit = {
              current: phoneNumberData.messaging_limit?.current || 0,
              total: phoneNumberData.messaging_limit?.total || 250,
              percentage: Math.round(((phoneNumberData.messaging_limit?.current || 0) / (phoneNumberData.messaging_limit?.total || 250)) * 100)
            };
          }
        }
      } catch (error) {
        console.error("Error fetching daily messaging limit from Meta API:", error);
        // Continue with default values
      }
    }

    // 2. Get messaging quality from Meta API
    let messagingQuality = { level: "Medium", score: 50 };
    try {
      const qualityResponse = await axios.get(
        `https://graph.facebook.com/v22.0/${selectedPhoneNumberId}?fields=quality_rating`,
        { 
          headers: { Authorization: `Bearer ${accessToken}` } 
        }
      );

      if (qualityResponse.data && qualityResponse.data.quality_rating) {
        const qualityRating = qualityResponse.data.quality_rating;
        
        // Map quality rating to level and score
        switch (qualityRating) {
          case "GREEN":
            messagingQuality = { level: "High", score: 90 };
            break;
          case "YELLOW":
            messagingQuality = { level: "Medium", score: 60 };
            break;
          case "RED":
            messagingQuality = { level: "Low", score: 30 };
            break;
          default:
            messagingQuality = { level: "Medium", score: 50 };
        }
      }
    } catch (error) {
      console.error("Error fetching messaging quality:", error);
      // Continue with default values
    }

    // 3. Calculate consecutive days from message history
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get all conversations for this business phone number
    const conversations = await prisma.conversation.findMany({
      where: { businessPhoneNumberId: businessPhoneNumber.id },
      select: { id: true }
    });

    const conversationIds = conversations.map(conv => conv.id);

    // Get all outgoing messages from the last 7 days
    const messages = await prisma.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        sender: "user", // Business messages are marked with "user" sender
        time: { gte: sevenDaysAgo }
      },
      select: { time: true }
    });

    // Group messages by date and check which days had messages
    const activeDays = new Array(7).fill(false);
    const today = new Date();
    
    for (let i = 0; i < 7; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      
      const dayStart = new Date(checkDate);
      dayStart.setHours(0, 0, 0, 0);
      
      const dayEnd = new Date(checkDate);
      dayEnd.setHours(23, 59, 59, 999);
      
      const hasMessagesOnDay = messages.some(message => {
        const messageDate = new Date(message.time);
        return messageDate >= dayStart && messageDate <= dayEnd;
      });
      
      activeDays[6 - i] = hasMessagesOnDay; // Reverse order to get chronological
    }

    const consecutiveDays = {
      count: activeDays.filter(day => day).length,
      totalDays: 7,
      activeDays: activeDays
    };

    return res.status(200).json({
      success: true,
      data: {
        dailyMessagingLimit,
        consecutiveDays,
        messagingQuality
      }
    });

  } catch (error) {
    console.error("Error fetching messaging analytics:", error);
    return res.status(500).json({ 
      success: false,
      message: "Failed to fetch messaging analytics." 
    });
  }
};

//     // 1. Get the logged-in user
//     const user: any = req.user;

//     // 2. Look up which phoneNumber they have selected and their business account
//     const dbUser = await prisma.user.findUnique({
//       where: { id: user.userId },
//       select: { 
//         selectedPhoneNumberId: true,
//         businessAccount: {
//           select: {
//             id: true,
//             phoneNumbers: {
//               where: {
//                 id: Number(user.selectedPhoneNumberId)
//               },
//               select: {
//                 id: true
//               }
//             }
//           }
//         }
//       },
//     });

//     if (!dbUser?.selectedPhoneNumberId) {
//       return res
//         .status(400)
//         .json({ message: "No phone number selected for this user." });
//     }

//     if (!dbUser.businessAccount?.[0]) {
//       return res
//         .status(400)
//         .json({ message: "No business account found for this user." });
//     }

//     // 3. Pull the payload from the frontend
//     const { enabled, message, maxTriggers } = req.body as {
//       enabled: boolean;
//       message: string;
//       maxTriggers: number;
//     };

//     // 4. Create or update the BusinessPhoneNumber record
//     const phoneNumber = await prisma.businessPhoneNumber.upsert({
//       where: { id: dbUser.businessAccount[0].phoneNumbers[0].id},
//       update: {
//         fallbackEnabled: enabled,
//         fallbackMessage: message,
//         fallbackTriggerCount: maxTriggers,
//       },
//       create: {
//         metaPhoneNumberId: dbUser.selectedPhoneNumberId,
//         businessAccountId: dbUser.businessAccount[0].id,
//         fallbackEnabled: enabled,
//         fallbackMessage: message,
//         fallbackTriggerCount: maxTriggers,
//       },
//     });

//     return res
//       .status(200)
//       .json({ 
//         message: "Fallback settings saved successfully.",
//         phoneNumber 
//       });
//   } catch (err) {
//     console.error("Error saving fallback settings:", err);
//     return res
//       .status(500)
//       .json({ message: "Unable to save fallback settings." });
//   }
// }; 