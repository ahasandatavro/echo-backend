import { Job } from '@hokify/agenda';
import { prisma } from '../models/prismaClient';
import { sendDefaultMaterial } from '../processors/metaWebhook/keywordProcessor';

interface NoResponse24hJobData {
  conversationId: number;
  recipient: string;
  agentPhoneNumberId: string | undefined;
}

export const processNoResponse24hJob = async (job: Job<NoResponse24hJobData>) => {
  try {
    const { conversationId, recipient, agentPhoneNumberId } = job.attrs.data;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        businessPhoneNumber: {
          include: {
            defaultActionSettings: true
          }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    });

    if (!conversation) {
      return;
    }

    if (conversation.noResponse24hSent) {
      return;
    }

    if (conversation.chatStatus === 'SOLVED') {
      return;
    }

    const durationMinutes = parseInt(process.env.NO_RESPONSE_24H_DURATION_MINUTES || '1440');
    const jobScheduledTime = new Date(Date.now() - (durationMinutes * 60 * 1000));
    const hasCustomerRepliedRecently = conversation.lastCustomerMessageAt &&
      conversation.lastCustomerMessageAt > jobScheduledTime;

    if (hasCustomerRepliedRecently) {
      return;
    }

    const recentCustomerMessages = conversation.messages.filter(msg =>
      msg.sender !== 'user' && 
      msg.createdAt > jobScheduledTime
    );

    if (recentCustomerMessages.length > 0) {
      return;
    }

    const defaultActionSettings = conversation.businessPhoneNumber?.defaultActionSettings;

    if (!defaultActionSettings?.noResponseAfter24hEnabled ||
        !defaultActionSettings.noResponseAfter24hMaterialType ||
        !defaultActionSettings.noResponseAfter24hMaterialId) {
      return;
    }

    const sent = await sendDefaultMaterial(
      defaultActionSettings.noResponseAfter24hMaterialType,
      defaultActionSettings.noResponseAfter24hMaterialId,
      recipient,
      1,
      agentPhoneNumberId
    );

    if (sent) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          noResponse24hSent: true,
          noResponse24hJobId: null
        }
      });
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        noResponse24hJobId: null
      }
    });

  } catch (error) {
    console.error('Error processing 24h no response job:', error);
  }
}; 