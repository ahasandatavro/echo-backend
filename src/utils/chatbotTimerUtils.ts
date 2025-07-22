import agenda from '../config/agenda';
import { prisma } from '../models/prismaClient';
import { sendMessage } from '../processors/metaWebhook/webhookProcessor';

const EXIT_NOTIFICATION_JOB = 'exitNotification';
const SESSION_END_JOB = 'sessionEnd';

// Cancel both jobs for a conversation
export async function cancelChatbotTimers(conversationId: number) {
  await agenda.cancel({ name: EXIT_NOTIFICATION_JOB, 'data.conversationId': conversationId });
  await agenda.cancel({ name: SESSION_END_JOB, 'data.conversationId': conversationId });
}

// Schedule both jobs for a conversation
export async function scheduleChatbotTimers(conversation: any) {
  // Get conversation, chatbot, and businessPhoneNumber

  if (!conversation || !conversation.businessPhoneNumber) return;
  const bpn = conversation.businessPhoneNumber;

  // Only schedule if enabled
  if (!bpn.timeoutMinutes || bpn.timeoutMinutes <= 0) return;

  // Cancel any existing jobs first
  await cancelChatbotTimers(conversation.id);

  // Schedule exit notification (if enabled)
  if (bpn.enableExitNotification && bpn.exitNotificationLeadTime > 0) {
    const notificationTime = (bpn.timeoutMinutes - bpn.exitNotificationLeadTime) * 60 * 1000;
    if (notificationTime > 0) {
      await agenda.schedule(new Date(Date.now() + notificationTime), EXIT_NOTIFICATION_JOB, { conversationId: conversation.id });
    }
  }

  // Schedule session end
  const sessionEndTime = bpn.timeoutMinutes * 60 * 1000;
  await agenda.schedule(new Date(Date.now() + sessionEndTime), SESSION_END_JOB, { conversationId: conversation.id });
}

// Handler for exit notification
export async function handleExitNotificationJob(job: any) {
  const { conversationId } = job.attrs.data;
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { businessPhoneNumber: true },
  });
  if (!conversation || !conversation.businessPhoneNumber) return;
  const bpn = conversation.businessPhoneNumber;
  if (!bpn.enableExitNotification) return;
  // Send notification message
  await sendMessage(
    conversation.recipient,
    { type: 'text', message: bpn.exitNotificationMessage },
    conversation.chatbotId || 1,
    1,
    true,
    bpn.metaPhoneNumberId
  );
}

// Handler for session end
export async function handleSessionEndJob(job: any) {
  const { conversationId } = job.attrs.data;
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { businessPhoneNumber: true },
  });
  if (!conversation || !conversation.businessPhoneNumber) return;
  // Set answeringQuestion to false
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { answeringQuestion: false },
  });
  // Send session end message (reuse exitNotificationMessage)
//   await sendMessage(
//     conversation.recipient,
//     { type: 'text', message: conversation.businessPhoneNumber.exitNotificationMessage },
//     conversation.chatbotId || 1,
//     1,
//     true,
//     conversation.businessPhoneNumber.metaPhoneNumberId
//   );
}

// Register Agenda job definitions (should be called once at startup)
export function registerChatbotTimerJobs() {
  agenda.define(EXIT_NOTIFICATION_JOB, async (job) => {
    await handleExitNotificationJob(job);
  });
  agenda.define(SESSION_END_JOB, async (job) => {
    await handleSessionEndJob(job);
  });
} 