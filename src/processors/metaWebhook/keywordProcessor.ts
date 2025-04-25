import { String } from "aws-sdk/clients/cloudsearch";
import { prisma } from "../../models/prismaClient";
import { processChatFlow, sendMessage, sendTemplate } from "./webhookProcessor";
import { Chatbot, Contact, Keyword, KeywordReplyMaterial, KeywordRoutingMaterial, KeywordTemplate, MaterialType, ReplyMaterial, RoutingMaterial, RoutingType, Team, Template, User } from "@prisma/client";
import dayjs from 'dayjs';
import { DefaultActionSettings } from '@prisma/client'; 
// Define types for the keyword query result
type KeywordWithRelations = Keyword & {
  chatbot: Chatbot | null;
  keywordTemplates: (KeywordTemplate & {
    template: Template;
  })[];
  replyMaterials: (KeywordReplyMaterial & {
    replyMaterial: ReplyMaterial;
  })[];
  routingMaterials: (KeywordRoutingMaterial & {
    routingMaterial: RoutingMaterial & {
      assignedUser: User | null;
      team: Team | null;
    };
  })[];
};

type TimeSlot = {
  from: string;
  to: string;
};

type DaySchedule = {
  open: boolean;
  times: TimeSlot[];
};

type WorkingHours = {
  [day: string]: DaySchedule;
};

export const processKeyword = async (text: string, recipient: String): Promise<boolean> => {
  if (!text) return false;
  
  const businessPhoneNumberId=5;
  const defaultActionSettings = await prisma.defaultActionSettings.findUnique({
    where: {
      businessPhoneNumberId: businessPhoneNumberId,
    },
  });
  // Use the new helper function
  const defaultHandled = await checkAndSendDefaultMaterial(defaultActionSettings, recipient);
  if (defaultHandled) return true;
  try {
    // Find keyword with all possible related entities
    const keyword = await prisma.keyword.findFirst({
      where: {
        value: {
          contains: text,
          mode: "insensitive",
        },
      },
      include: { 
        chatbot: true,
        keywordTemplates: {
          include: {
            template: true
          }
        },
        replyMaterials: {
          include: {
            replyMaterial: true
          }
        },
        routingMaterials: {
          include: {
            routingMaterial: {
              include: {
                assignedUser: true,
                team: true
              }
            }
          }
        }
      }
    }) as KeywordWithRelations | null;

    if (!keyword) {
      return await handleFallbackMaterial(defaultActionSettings, recipient);
    }
    
    let actionsPerformed = false;

    // 1. Process chatbot if associated
    if (keyword.chatbot) {
      console.log(`Triggering chatbot with ID: ${keyword.chatbot.id} for keyword "${keyword.value}"`);
      
      // Update conversation to not be answering a question anymore
      const conversation = await prisma.conversation.findFirst({ 
        where: { recipient },
        orderBy: { updatedAt: "desc" } 
      });
      
      if (conversation) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { answeringQuestion: false }
        });
      }

      // Process the chatbot flow
      await processChatFlow(keyword.chatbot.id, recipient);
      actionsPerformed = true;
    }

    // 2. Process templates if associated
    if (keyword.keywordTemplates && keyword.keywordTemplates.length > 0) {
      for (const keywordTemplate of keyword.keywordTemplates) {
        if (keywordTemplate.template) {
          console.log(`Sending template "${keywordTemplate.template.name}" for keyword "${keyword.value}"`);
          
          // Use default chatbotId 1 if no chatbot is associated with the keyword
          const chatbotId = keyword.chatbot?.id || 1;
          
          await sendTemplate(
            recipient, 
            keywordTemplate.template.name, 
            chatbotId,
            keywordTemplate.template
          );
          actionsPerformed = true;
        }
      }
    }

    // 3. Process reply materials if associated
    if (keyword.replyMaterials && keyword.replyMaterials.length > 0) {
      for (const keywordReplyMaterial of keyword.replyMaterials) {
        const replyMaterial = keywordReplyMaterial.replyMaterial;
        if (replyMaterial) {
          console.log(`Sending reply material "${replyMaterial.name}" for keyword "${keyword.value}"`);
          
          // Determine the message type and content based on material type
          let messageContent: any;
          
          // Convert MaterialType to a format that sendMessage understands
          if (replyMaterial.type === "TEXT") {
            // Handle text type - simplest format
            messageContent = {
              type: "text", 
              message: replyMaterial.content || replyMaterial.name
            };
          } else {
            // Handle media types (IMAGE, VIDEO, DOCUMENT, etc.)
            messageContent = {
              type: replyMaterial.type.toLowerCase(),
              message: {
                name: replyMaterial.name,
                url: replyMaterial.fileUrl
              }
            };
          }

          // Use default chatbotId 1 if no chatbot is associated with the keyword
          const chatbotId = keyword.chatbot?.id || 1;
          
          await sendMessage(recipient, messageContent, chatbotId);
          actionsPerformed = true;
        }
      }
    }

    // 4. Process routing materials if associated
    if (keyword.routingMaterials && keyword.routingMaterials.length > 0) {
      for (const keywordRoutingMaterial of keyword.routingMaterials) {
        const routingMaterial = keywordRoutingMaterial.routingMaterial;
        
        if (routingMaterial) {
          console.log(`Processing routing material "${routingMaterial.materialName}" for keyword "${keyword.value}"`);
          
          // Perform actions based on routing type
          switch (routingMaterial.type) {
            case "AssignUser":
              if (routingMaterial.assignedUser && routingMaterial.assignedUserId) {
                await prisma.contact.upsert({
                  where: { phoneNumber: recipient },
                  update: { userId: routingMaterial.assignedUserId },
                  create: {
                    phoneNumber: recipient,
                    name: "Unknown",
                    source: "WhatsApp",
                    userId: routingMaterial.assignedUserId,
                  }
                });
                console.log(`Assigned user ID ${routingMaterial.assignedUserId} to contact ${recipient}`);
              }
              break;
              
            case "AssignTeam":
              if (routingMaterial.team && routingMaterial.teamId) {
                const contact = await prisma.contact.findUnique({
                  where: { phoneNumber: recipient },
                  include: { assignedTeams: true }
                }) as (Contact & { assignedTeams: Team[] }) | null;
                
                if (contact) {
                  // Add the team to contact's teams if not already assigned
                  const isTeamAssigned = contact.assignedTeams.some(t => t.id === routingMaterial.teamId);
                  
                  if (!isTeamAssigned && routingMaterial.teamId) {
                    await prisma.contact.update({
                      where: { id: contact.id },
                      data: {
                        assignedTeams: {
                          connect: { id: routingMaterial.teamId }
                        }
                      }
                    });
                    console.log(`Assigned team ID ${routingMaterial.teamId} to contact ${recipient}`);
                  }
                } else {
                  // Create contact with team assignment
                  if (routingMaterial.teamId) {
                    await prisma.contact.create({
                      data: {
                        phoneNumber: recipient,
                        name: "Unknown",
                        source: "WhatsApp",
                        assignedTeams: {
                          connect: { id: routingMaterial.teamId }
                        }
                      }
                    });
                    console.log(`Created contact ${recipient} with team ID ${routingMaterial.teamId}`);
                  }
                }
              }
              break;
              
            case "Notification":
              // For Notification type, we don't need immediate action in the webhook,
              // as this would typically generate notifications elsewhere in the system
              console.log(`Notification routing triggered for ${recipient} with material ID ${routingMaterial.id}`);
              break;
          }
          
          actionsPerformed = true;
        }
      }
    }

    return actionsPerformed;
  } catch (error) {
    console.error(`Error processing keyword "${text}":`, error);
    return false;
  }
}; 

const checkAndSendDefaultMaterial = async (
  defaultActionSettings: any,
  recipient: string
): Promise<boolean> => {
  if (
    defaultActionSettings?.outsideWorkingHoursEnabled &&
    defaultActionSettings.workingHours
  ) {
    const workingHours = defaultActionSettings.workingHours as WorkingHours;

    if (!isWithinWorkingHours(workingHours)) {
      const type = defaultActionSettings.outsideWorkingHoursMaterialType;
      const id = defaultActionSettings.outsideWorkingHoursMaterialId;

      if (type && id) {
        const sent = await sendDefaultMaterial(type, id, recipient);
        if (sent) return true;
      }
    }
  }
  return false;
};


export const sendDefaultMaterial = async (
  type: keyof typeof MaterialType | string,
  id: number,
  recipient: string,
  fallbackChatbotId: number = 1
): Promise<boolean> => {
  try {
    switch (type) {
      case 'TEXT':
      case 'IMAGE':
      case 'VIDEO':
      case 'DOCUMENT':
      case 'STICKER':
      case 'CONTACT_ATTRIBUTES': {
        const replyMaterial = await prisma.replyMaterial.findUnique({ where: { id } });
        if (replyMaterial) {
          const messageContent = replyMaterial.type === 'TEXT'
            ? { type: 'text', message: replyMaterial.content || replyMaterial.name }
            : {
                type: replyMaterial.type.toLowerCase(),
                message: {
                  name: replyMaterial.name,
                  url: replyMaterial.fileUrl,
                },
              };

          await sendMessage(recipient, messageContent, fallbackChatbotId);
          return true;
        }
        break;
      }

      case 'template': {
        const template = await prisma.template.findUnique({ where: { id } });
        if (template) {
          await sendTemplate(recipient, template.name, fallbackChatbotId, template);
          return true;
        }
        break;
      }
      case 'templates': {
        const template = await prisma.template.findUnique({ where: { id } });
        if (template) {
          await sendTemplate(recipient, template.name, fallbackChatbotId, template);
          return true;
        }
        break;
      }
      case 'chatbot': {
        await processChatFlow(id, recipient);
        return true;
      }

      default:
        console.warn(`Unsupported default material type: ${type}`);
    }
  } catch (error) {
    console.error(`Failed to send default material (type: ${type}, id: ${id})`, error);
  }

  return false;
};

export const isWithinWorkingHours = (workingHours: WorkingHours): boolean => {
  const now = dayjs();
  const currentDay = now.format('dddd'); // e.g., "Thursday"
  const todaySchedule = workingHours[currentDay];

  if (!todaySchedule?.open || !Array.isArray(todaySchedule.times)) return false;

  for (const timeSlot of todaySchedule.times) {
    const from = dayjs(`${now.format('YYYY-MM-DD')} ${timeSlot.from}`);
    let to = dayjs(`${now.format('YYYY-MM-DD')} ${timeSlot.to}`);

    // Handle overnight shift: e.g., from 23:00 to 06:00
    if (to.isBefore(from)) {
      to = to.add(1, 'day');
    }

    if (now.isAfter(from) && now.isBefore(to)) {
      return true;
    }
  }

  return false;
};

export const handleFallbackMaterial = async (
  defaultActionSettings: DefaultActionSettings | null,
  recipient: string
): Promise<boolean> => {
  try {
    if (
      defaultActionSettings?.fallbackMessageEnabled &&
      defaultActionSettings.fallbackMessageMaterialType &&
      defaultActionSettings.fallbackMessageMaterialId
    ) {
      console.log(`No keyword matched. Sending fallback material of type "${defaultActionSettings.fallbackMessageMaterialType}"`);

      const sent = await sendDefaultMaterial(
        defaultActionSettings.fallbackMessageMaterialType,
        defaultActionSettings.fallbackMessageMaterialId,
        recipient
      );

      return sent;
    }

    console.log(`No keyword matched and fallback is disabled or incomplete.`);
    return false;
  } catch (error) {
    console.error('Error handling fallback material:', error);
    return false;
  }
};
