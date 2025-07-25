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

    console.log(`🕐 Processing no response job for conversation ${conversationId}`);
    console.log(`📋 Job data:`, job.attrs.data);
    console.log(`⏰ Job scheduled at: ${job.attrs.nextRunAt}`);
    console.log(`🔍 Current time: ${new Date().toISOString()}`);

    // Get the conversation with its business phone number and default action settings
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
          take: 20 // Get last 20 messages to check for customer activity
        }
      }
    });

    if (!conversation) {
      console.log(`❌ Conversation ${conversationId} not found, skipping no response action`);
      return;
    }

    // Check if no response action was already sent
    if (conversation.noResponse24hSent) {
      console.log(`✋ No response action already sent for conversation ${conversationId}`);
      return;
    }

    // Check if conversation is SOLVED
    if (conversation.chatStatus === 'SOLVED') {
      console.log(`✋ Conversation ${conversationId} is SOLVED, skipping 24h action`);
      return;
    }

    // Check if customer has responded in the configured duration
    const durationMinutes = parseInt(process.env.NO_RESPONSE_24H_DURATION_MINUTES || '1440'); // Default 1440 minutes = 24 hours
    const jobScheduledTime = new Date(Date.now() - (durationMinutes * 60 * 1000));
    const hasCustomerRepliedRecently = conversation.lastCustomerMessageAt && 
      conversation.lastCustomerMessageAt > jobScheduledTime;

    console.log(`📅 Job was scheduled around: ${jobScheduledTime.toISOString()} (${durationMinutes} minutes ago)`);
    console.log(`💬 Last customer message at: ${conversation.lastCustomerMessageAt?.toISOString() || 'Never'}`);
    console.log(`🔍 Customer replied in last ${durationMinutes} minutes: ${hasCustomerRepliedRecently}`);

    if (hasCustomerRepliedRecently) {
      console.log(`✋ Customer replied to conversation ${conversationId} in last ${durationMinutes} minutes, skipping action`);
      return;
    }

    // Additional check: Look for recent customer messages in the conversation
    const recentCustomerMessages = conversation.messages.filter(msg => 
      msg.sender !== 'user' && // Assuming non-'user' means customer messages
      msg.createdAt > jobScheduledTime
    );

    console.log(`📨 Found ${recentCustomerMessages.length} recent customer messages in last ${durationMinutes} minutes`);

    if (recentCustomerMessages.length > 0) {
      console.log(`✋ Found recent customer messages in conversation ${conversationId}, skipping action`);
      return;
    }

    const defaultActionSettings = conversation.businessPhoneNumber?.defaultActionSettings;

    // Check if 24h no response action is enabled and configured
    if (!defaultActionSettings?.noResponseAfter24hEnabled || 
        !defaultActionSettings.noResponseAfter24hMaterialType || 
        !defaultActionSettings.noResponseAfter24hMaterialId) {
      console.log(`❌ 24h no response action not enabled or not configured for conversation ${conversationId}`);
      return;
    }

    // Send the 24h no response action
    console.log(`📤 Sending 24h no response action for conversation ${conversationId}`);
    const sent = await sendDefaultMaterial(
      defaultActionSettings.noResponseAfter24hMaterialType,
      defaultActionSettings.noResponseAfter24hMaterialId,
      recipient,
      1,
      agentPhoneNumberId
    );

    if (sent) {
      // Mark 24h action as sent and clear job ID
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          noResponse24hSent: true,
          noResponse24hJobId: null
        }
      });
      console.log(`✅ 24-hour no response action sent successfully for conversation ${conversationId}`);
    } else {
      console.error(`❌ Failed to send 24h no response action for conversation ${conversationId}`);
    }

    // Always clear the job ID after processing (whether sent or not)
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        noResponse24hJobId: null
      }
    });
    console.log(`🧹 Cleared 24h job ID for conversation ${conversationId}`);

  } catch (error) {
    console.error('❌ Error processing 24h no response job:', error);
  }
}; 