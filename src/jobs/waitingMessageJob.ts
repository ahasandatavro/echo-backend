import { Job } from '@hokify/agenda';
import { prisma } from '../models/prismaClient';
import { sendDefaultMaterial } from '../processors/metaWebhook/keywordProcessor';

interface WaitingMessageJobData {
  conversationId: number;
  recipient: string;
  agentPhoneNumberId: string | undefined;
}

export const processWaitingMessageJob = async (job: Job<WaitingMessageJobData>) => {
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
          take: 10
        }
      }
    });

    if (!conversation) {
      return;
    }

    if (conversation.waitingMessageSent) {
      return;
    }

    const durationMinutes = parseInt(process.env.WAITING_MESSAGE_DURATION_MINUTES || '10');
    const jobScheduledTime = new Date(Date.now() - (durationMinutes * 60 * 1000));
    const hasAgentRepliedSinceScheduled = conversation.lastAgentMessageAt && 
      conversation.lastAgentMessageAt > jobScheduledTime;

    if (hasAgentRepliedSinceScheduled) {
      return;
    }

    const recentAgentMessages = conversation.messages.filter(msg => 
      msg.sender === 'user' && 
      msg.createdAt > jobScheduledTime
    );

    if (recentAgentMessages.length > 0) {
      return;
    }

    const defaultActionSettings = conversation.businessPhoneNumber?.defaultActionSettings;

    if (!defaultActionSettings?.waitingMessageEnabled || 
        !defaultActionSettings.waitingMessageMaterialType || 
        !defaultActionSettings.waitingMessageMaterialId) {
      return;
    }

    const sent = await sendDefaultMaterial(
      defaultActionSettings.waitingMessageMaterialType,
      defaultActionSettings.waitingMessageMaterialId,
      recipient,
      1,
      agentPhoneNumberId
    );

    if (sent) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          waitingMessageSent: true,
          waitingJobId: null
        }
      });
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        waitingJobId: null
      }
    });

  } catch (error) {
    console.error('Error processing waiting message job:', error);
  }
}; 