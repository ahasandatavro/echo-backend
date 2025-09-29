import {String} from "aws-sdk/clients/cloudsearch";
import {prisma} from "../../models/prismaClient";
import {processChatFlow, sendMessage, sendTemplate} from "./webhookProcessor";
import {
  Chatbot,
  Contact,
  Keyword,
  KeywordReplyMaterial,
  KeywordRoutingMaterial,
  KeywordTemplate,
  MaterialType,
  ReplyMaterial,
  RoutingMaterial,
  RoutingType,
  Team,
  Template,
  User
} from "../../models/prismaClient";
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {DefaultActionSettings} from '../../models/prismaClient';
import {bump} from "../../helpers";
import {findMatchingKeyword} from "../../utils/keywordMatcher";
import {cancelAndRescheduleWaitingMessage, cancelWaitingMessageForConversation} from "../../utils/waitingMessageUtils";
import {updateCustomerMessageTimestamp, cancel24hJobForConversation} from "../../utils/noResponse24hUtils";

// Extend dayjs with timezone plugins
dayjs.extend(utc);
dayjs.extend(timezone);
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

export const processKeyword = async (text: string, recipient: String, agentPhoneNumberId: string | undefined): Promise<boolean> => {

  if (!text) return false;

  const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
    where: {metaPhoneNumberId: agentPhoneNumberId},
    select: {
      id: true,
      fallbackEnabled: true,
      fallbackMessage: true,
      fallbackTriggerCount: true,
      defaultActionSettings: true,  // your existing logic
      fallbackHitCount: true,
      metaPhoneNumberId: true,
    }
  });
  const dbUser = await prisma.user.findFirst({where: {selectedPhoneNumberId: businessPhoneNumber?.metaPhoneNumberId}})
  const defaultActionSettings = await prisma.defaultActionSettings.findUnique({
    where: {
      businessPhoneNumberId: businessPhoneNumber?.id,
    },
  });

  const conversation = await prisma.conversation.findFirst({
    where: {
      recipient: recipient as string,
      businessPhoneNumberId: businessPhoneNumber?.id
    },
    orderBy: {updatedAt: 'desc'}
  });

  if (conversation) {
    await updateCustomerMessageTimestamp(conversation.id);
  }

  // Use the new helper function
  const defaultHandled = await checkAndSendDefaultMaterial(defaultActionSettings, recipient, agentPhoneNumberId, text);
  if (defaultHandled) return true;
  try {
    // Get all keywords for the user to perform advanced matching
    const allKeywords = await prisma.keyword.findMany({
      where: {
        userId: dbUser?.id
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
    }) as KeywordWithRelations[];

    // Use the new matching logic to find the best matching keyword
    const matchResult = findMatchingKeyword(text, allKeywords);
    const keyword = matchResult?.keyword as KeywordWithRelations | null;

    if (matchResult) {
      const conversation = await prisma.conversation.findFirst({
        where: {
          recipient: recipient as string,
          businessPhoneNumberId: businessPhoneNumber?.id
        },
        orderBy: {updatedAt: 'desc'}
      });

      if (conversation) {
        await cancelWaitingMessageForConversation(conversation.id);
        await cancel24hJobForConversation(conversation.id);
      }
    }

    if (!keyword) {
      if (defaultActionSettings?.workingHours) {
        console.log(`🕐 Checking working hours for waiting message scheduling...`);

        // Get user's timezone for working hours check
        const user = await prisma.user.findFirst({
          where: {selectedPhoneNumberId: agentPhoneNumberId},
          include: {businessAccount: true}
        });
        const userTimezone = user?.businessAccount?.[0]?.timeZone || 'UTC';

        console.log(`🌍 Timezone information:`);
        console.log(`   - User ID: ${user?.id || 'NOT FOUND'}`);
        console.log(`   - Business Account ID: ${user?.businessAccount?.[0]?.id || 'NOT FOUND'}`);
        console.log(`   - User Timezone: ${userTimezone}`);
        console.log(`   - Working Hours Enabled: ${defaultActionSettings.waitingMessageEnabled}`);

        const isWithinHours = isWithinWorkingHours(defaultActionSettings.workingHours as WorkingHours, userTimezone);

        console.log(`📊 Working hours check result: ${isWithinHours ? 'WITHIN HOURS' : 'OUTSIDE HOURS'}`);

        if (defaultActionSettings.waitingMessageEnabled && isWithinHours) {
          let conversation = await prisma.conversation.findFirst({
            where: {
              recipient: recipient as string,
              businessPhoneNumberId: businessPhoneNumber?.id
            },
            orderBy: {updatedAt: 'desc'}
          });

          if (!conversation && businessPhoneNumber?.id) {
            conversation = await prisma.conversation.create({
              data: {
                recipient: recipient as string,
                businessPhoneNumberId: businessPhoneNumber.id,
                answeringQuestion: false
              }
            });
          }

          if (conversation) {
            await cancelAndRescheduleWaitingMessage(
              conversation.id,
              recipient as string,
              agentPhoneNumberId
            );
          }
        }
      }

      // Handle fallback message (waiting message takes priority over fallback)
      if (defaultActionSettings?.fallbackMessageEnabled) {
        const type = defaultActionSettings.fallbackMessageMaterialType;
        const id = defaultActionSettings.fallbackMessageMaterialId;

        if (type && id) {
          const sent = await sendDefaultMaterial(type, id, recipient, 1, agentPhoneNumberId);
          if (sent) return true;
        }
      } else return false;

    }

    let actionsPerformed = false;

    // 1. Process chatbot if associated
    if (keyword?.chatbot) {
      console.log(`Triggering chatbot with ID: ${keyword.chatbot.id} for keyword "${keyword.value}"`);
      await bump(keyword.chatbot.id, "triggered");
      // Update conversation to not be answering a question anymore
      const conversation = await prisma.conversation.findFirst({
        where: {recipient},
        orderBy: {updatedAt: "desc"}
      });

      if (conversation) {
        await prisma.conversation.update({
          where: {id: conversation.id},
          data: {answeringQuestion: false}
        });
      }

      // Process the chatbot flow
      await processChatFlow(keyword.chatbot.id, recipient, agentPhoneNumberId);
      actionsPerformed = true;
    }

    // 2. Process templates if associated
    if (keyword?.keywordTemplates && keyword.keywordTemplates.length > 0) {
      for (const keywordTemplate of keyword.keywordTemplates) {
        if (keywordTemplate.template) {
          console.log(`Sending template "${keywordTemplate.template.name}" for keyword "${keyword.value}"`);

          // Use default chatbotId 1 if no chatbot is associated with the keyword
          const chatbotId = keyword.chatbot?.id || 1;

          await sendTemplate(
            recipient,
            keywordTemplate.template.name,
            chatbotId,
            keywordTemplate.template,
            agentPhoneNumberId
          );
          actionsPerformed = true;
        }
      }
    }

    // 3. Process reply materials if associated
    if (keyword?.replyMaterials && keyword.replyMaterials.length > 0) {
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

          await sendMessage(recipient, messageContent, chatbotId, dbUser?.id, true, agentPhoneNumberId);
          actionsPerformed = true;
        }
      }
    }

    // 4. Process routing materials if associated
    if (keyword?.routingMaterials && keyword.routingMaterials.length > 0) {
      for (const keywordRoutingMaterial of keyword.routingMaterials) {
        const routingMaterial = keywordRoutingMaterial.routingMaterial;

        if (routingMaterial) {
          console.log(`Processing routing material "${routingMaterial.materialName}" for keyword "${keyword.value}"`);

          // Perform actions based on routing type
          switch (routingMaterial.type) {
            case "AssignUser":
              if (routingMaterial.assignedUser && routingMaterial.assignedUserId) {
                await prisma.contact.upsert({
                  where: {phoneNumber: recipient},
                  update: {userId: routingMaterial.assignedUserId},
                  create: {
                    phoneNumber: recipient,
                    name: "Unknown",
                    source: "WhatsApp",
                    userId: routingMaterial.assignedUserId,
                  }
                });
                console.log(`Assigned user ID ${routingMaterial.assignedUserId} to contact ${recipient}`);
                const contactRecord = await prisma.contact.findUnique({
                  where: {phoneNumber: recipient},
                  select: {id: true}
                });
                if (!contactRecord) {
                  throw new Error(`Contact with phoneNumber ${recipient} not found.`);
                }
                await prisma.chatStatusHistory.create({
                  data: {
                    contactId: contactRecord?.id || 0,
                    newStatus: "Assigned",
                    type: "assignmentChanged",
                    note: `Assigned to agent ${routingMaterial.assignedUser.email}`,
                    assignedToUserId: routingMaterial.assignedUserId,
                    changedById: null,
                    changedAt: new Date(),
                  }
                });
              }
              break;

            case "AssignTeam":
              if (routingMaterial.team && routingMaterial.teamId) {
                const contact = await prisma.contact.findUnique({
                  where: {phoneNumber: recipient},
                  include: {assignedTeams: true}
                }) as (Contact & { assignedTeams: Team[] }) | null;

                if (contact) {
                  // Add the team to contact's teams if not already assigned
                  const isTeamAssigned = contact.assignedTeams.some(t => t.id === routingMaterial.teamId);

                  if (!isTeamAssigned && routingMaterial.teamId) {
                    await prisma.contact.update({
                      where: {id: contact.id},
                      data: {
                        assignedTeams: {
                          connect: {id: routingMaterial.teamId}
                        }
                      }
                    });
                    console.log(`Assigned team ID ${routingMaterial.teamId} to contact ${recipient}`);
                    const contactRecord = await prisma.contact.findUnique({
                      where: {phoneNumber: recipient},
                      select: {id: true}
                    });
                    if (!contactRecord) {
                      throw new Error(`Contact with phoneNumber ${recipient} not found.`);
                    }
                    await prisma.chatStatusHistory.create({
                      data: {
                        contactId: contactRecord?.id || 0,
                        newStatus: "Assigned",
                        type: "assignmentChanged",
                        note: `Assigned to Team: ${routingMaterial.team.name}`,
                        changedById: null,
                        changedAt: new Date(),
                      }
                    });
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
                          connect: {id: routingMaterial.teamId}
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
  recipient: string,
  agentPhoneNumberId: string | undefined,
  text: string
): Promise<boolean> => {
  // Early return if no defaultActionSettings
  if (!defaultActionSettings) {
    return false;
  }

  const workingHours = defaultActionSettings.workingHours as WorkingHours;
  // Check for outside working hours

  console.log(`🕐 Checking outside working hours conditions...`);

  // Get user's timezone for working hours check
  const user = await prisma.user.findFirst({
    where: {selectedPhoneNumberId: agentPhoneNumberId},
    include: {businessAccount: true}
  });
  const userTimezone = user?.businessAccount?.[0]?.timeZone || 'UTC';


  if (
    defaultActionSettings?.outsideWorkingHoursEnabled &&
    defaultActionSettings.workingHours
  ) {

    console.log(`🌍 Outside working hours check:`);
    console.log(`   - User ID: ${user?.id || 'NOT FOUND'}`);
    console.log(`   - Business Account ID: ${user?.businessAccount?.[0]?.id || 'NOT FOUND'}`);
    console.log(`   - User Timezone: ${userTimezone}`);
    console.log(`   - Outside Working Hours Enabled: ${defaultActionSettings.outsideWorkingHoursEnabled}`);

    if (!isWithinWorkingHours(workingHours, userTimezone)) {
      let dbUser = await prisma.user.findFirst({where: {selectedPhoneNumberId: agentPhoneNumberId}});

      // Get all keywords for the user to perform advanced matching
      const allKeywords = await prisma.keyword.findMany({
        where: {
          userId: dbUser?.id
        }
      });

      // Use the new matching logic to find the best matching keyword
      const matchResult = findMatchingKeyword(text, allKeywords);
      const keyword = matchResult?.keyword;
      if (keyword) {
        if (defaultActionSettings?.noKeywordMatchReplyEnabled) {
          const type = defaultActionSettings.outsideWorkingHoursMaterialType;
          const id = defaultActionSettings.outsideWorkingHoursMaterialId;

          if (type && id) {
            const sent = await sendDefaultMaterial(type, id, recipient, 1, agentPhoneNumberId);
            if (sent) return true;
          }
        }
      }
      if (!keyword) {
        const type = defaultActionSettings.outsideWorkingHoursMaterialType;
        const id = defaultActionSettings.outsideWorkingHoursMaterialId;

        if (type && id) {
          const sent = await sendDefaultMaterial(type, id, recipient, 1, agentPhoneNumberId);
          if (sent) return true;
        }
      }
    }
  }


  // Check for no agents online
  if (workingHours && isWithinWorkingHours(workingHours, userTimezone) && defaultActionSettings?.noAgentOnlineEnabled && agentPhoneNumberId) {
    // Find all agents with matching selectedPhoneNumberId
    const agents = await prisma.user.findMany({
      where: {
        selectedPhoneNumberId: agentPhoneNumberId,
      },
      select: {
        isOnline: true
      }
    });

    // Check if any agent is online
    const hasOnlineAgent = agents.some(agent => agent.isOnline);

    if (!hasOnlineAgent) {
      const type = defaultActionSettings.noAgentOnlineMaterialType;
      const id = defaultActionSettings.noAgentOnlineMaterialId;

      if (type && id) {
        const sent = await sendDefaultMaterial(type, id, recipient, 1, agentPhoneNumberId);
        if (sent) return true;
      }
    }
  }
  // Only send if this is the first message (no conversation exists for this recipient and agentPhoneNumberId)
  const existingConversation = await prisma.conversation.findFirst({
    where: {
      recipient,
      businessPhoneNumberId: defaultActionSettings.businessPhoneNumberId,
    },
  });

  const contact = await prisma.contact.findFirst({
    where: {
      phoneNumber: recipient,
    },
    include: {
      assignedTeams: true
    }
  });
  const contactTeamIds = contact?.assignedTeams.map((team) => team.id);
  const agents = await prisma.user.findMany({
    where: {
      teams: {
        some: {
          id: {in: contactTeamIds}
        }
      }
    },
    distinct: ['id']
  });
  if (defaultActionSettings?.roundRobinAssignmentEnabled && agentPhoneNumberId) {
    const botUser = await prisma.user.findFirst({where: {email: "bot"}});
    // If contact exists and not already assigned
    if (contact && contactTeamIds && contactTeamIds.length > 0 && agents.length > 0 && contact.userId == botUser?.id) {
      // Get or create round robin tracker (could be a separate table or a key-value config table)
      const rrState = await prisma.roundRobinState.findFirst({
        where: {
          phoneNumberId: agentPhoneNumberId,
        },
      });

      let nextIndex = 0;

      if (rrState) {
        nextIndex = (rrState.lastAssignedIndex + 1) % agents.length;

        await prisma.roundRobinState.update({
          where: {phoneNumberId: agentPhoneNumberId},
          data: {
            lastAssignedIndex: nextIndex,
          },
        });
      } else {
        // Create tracker if doesn't exist
        await prisma.roundRobinState.create({
          data: {
            phoneNumberId: agentPhoneNumberId,
            lastAssignedIndex: nextIndex,
          },
        });
      }

      // Assign the selected agent to this contact
      const assignedAgent = agents[nextIndex];
      await prisma.contact.update({
        where: {
          id: contact.id,
        },
        data: {
          userId: assignedAgent.id,
        },
      });
      await prisma.chatStatusHistory.create({
        data: {
          contactId: contact.id,
          newStatus: "Assigned",
          type: "assignmentChanged",
          note: `Assigned to agent ${assignedAgent?.email}`,
          assignedToUserId: assignedAgent?.id,
          changedById: null,
          changedAt: new Date(),
        }
      })
    }
  }
//find the messages length for this conversation. If lessthan two then send the welcome message else do nothing
  const messages = await prisma.message.findMany({
    where: {
      conversationId: existingConversation?.id,
    },
  });
  if (messages.length < 2) {
    // Check for keyword match (same logic as processKeyword)
    let dbUser = await prisma.user.findFirst({where: {selectedPhoneNumberId: agentPhoneNumberId}});

    // Get all keywords for the user to perform advanced matching
    const allKeywords = await prisma.keyword.findMany({
      where: {
        userId: dbUser?.id
      }
    });

    // Use the new matching logic to find the best matching keyword
    const matchResult = findMatchingKeyword(text, allKeywords);
    const keyword = matchResult?.keyword;

    if (!keyword && defaultActionSettings?.welcomeMessageEnabled) {
      const type = defaultActionSettings.welcomeMessageMaterialType;
      const id = defaultActionSettings.welcomeMessageMaterialId;

      if (type && id) {
        const sent = await sendDefaultMaterial(type, id, recipient, 1, agentPhoneNumberId);
        if (sent) return true;
      }
    }


  } else {
    return false;
  }


  return false;
};


export const sendDefaultMaterial = async (
  type: keyof typeof MaterialType | string,
  id: number,
  recipient: string,
  fallbackChatbotId: number = 1,
  agentPhoneNumberId: string | undefined
): Promise<boolean> => {
  try {
    switch (type) {
      case 'TEXT':
      case 'IMAGE':
      case 'VIDEO':
      case 'DOCUMENT':
      case 'STICKER':
      case 'CONTACT_ATTRIBUTES': {
        const replyMaterial = await prisma.replyMaterial.findUnique({where: {id}});
        if (replyMaterial) {
          const messageContent = replyMaterial.type === 'TEXT'
            ? {type: 'text', message: replyMaterial.content || replyMaterial.name}
            : {
              type: replyMaterial.type.toLowerCase(),
              message: {
                name: replyMaterial.name,
                url: replyMaterial.fileUrl,
              },
            };

          await sendMessage(recipient, messageContent, fallbackChatbotId, 1, true, agentPhoneNumberId);
          return true;
        }
        break;
      }

      case 'template': {
        const template = await prisma.template.findUnique({where: {id}});
        if (template) {
          await sendTemplate(recipient, template.name, fallbackChatbotId, template, agentPhoneNumberId);
          return true;
        }
        break;
      }
      case 'templates': {
        const template = await prisma.template.findUnique({where: {id}});
        if (template) {
          await sendTemplate(recipient, template.name, fallbackChatbotId, template, agentPhoneNumberId);
          return true;
        }
        break;
      }
      case 'chatbot': {
        await processChatFlow(id, recipient, agentPhoneNumberId);
        return true;
      }
      case 'chatbots': {
        await processChatFlow(id, recipient, agentPhoneNumberId);
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

export const isWithinWorkingHours = (workingHours: WorkingHours, userTimezone?: string): boolean => {
  console.log(`🕐 isWithinWorkingHours called:`);
  console.log(`   - userTimezone: ${userTimezone || 'NOT SPECIFIED'}`);
  console.log(`   - workingHours:`, JSON.stringify(workingHours, null, 2));

  // If no timezone specified, use server timezone (backward compatibility)
  if (!userTimezone || userTimezone === 'UTC') {
    console.log(`🌍 No timezone specified or UTC - using server timezone`);
    const now = dayjs();
    const currentDay = now.format('dddd'); // e.g., "Thursday"
    const todaySchedule = workingHours[currentDay];

    console.log(`📅 Server timezone check:`);
    console.log(`   - Current server time: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`   - Current day: ${currentDay}`);
    console.log(`   - Today's schedule:`, todaySchedule);

    if (!todaySchedule?.open || !Array.isArray(todaySchedule.times)) {
      console.log(`❌ No schedule for today or schedule is closed`);
      return false;
    }

    for (const timeSlot of todaySchedule.times) {
      const from = dayjs(`${now.format('YYYY-MM-DD')} ${timeSlot.from}`);
      let to = dayjs(`${now.format('YYYY-MM-DD')} ${timeSlot.to}`);

      // Handle overnight shift: e.g., from 23:00 to 06:00
      if (to.isBefore(from)) {
        to = to.add(1, 'day');
        console.log(`🌙 Overnight shift detected: ${timeSlot.from} to ${timeSlot.to} (next day)`);
      }

      console.log(`⏰ Checking time slot: ${timeSlot.from} - ${timeSlot.to}`);
      console.log(`   - From: ${from.format('YYYY-MM-DD HH:mm:ss')}`);
      console.log(`   - To: ${to.format('YYYY-MM-DD HH:mm:ss')}`);
      console.log(`   - Current: ${now.format('YYYY-MM-DD HH:mm:ss')}`);

      if (now.isAfter(from) && now.isBefore(to)) {
        console.log(`✅ Current time is within this slot`);
        return true;
      } else {
        console.log(`❌ Current time is outside this slot`);
      }
    }
    console.log(`❌ Current time is not within any working hours slot`);
    return false;
  }

  // Timezone-aware working hours checking
  console.log(`🌍 Timezone-aware working hours check for: ${userTimezone}`);
  console.log(`   - NOTE: Working hours are stored in UTC in database`);
  console.log(`   - Converting current time to user timezone for comparison`);

  try {
    // Get current time in user's timezone
    const now = dayjs().tz(userTimezone);
    const currentDay = now.format('dddd'); // e.g., "Thursday"
    const todaySchedule = workingHours[currentDay];

    console.log(`📅 User timezone check:`);
    console.log(`   - Server UTC time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')} UTC`);
    console.log(`   - User local time: ${now.format('YYYY-MM-DD HH:mm:ss')} ${userTimezone}`);
    console.log(`   - Current day: ${currentDay}`);
    console.log(`   - Today's schedule (stored in UTC):`, todaySchedule);

    if (!todaySchedule?.open || !Array.isArray(todaySchedule.times)) {
      console.log(`❌ No schedule for today or schedule is closed`);
      return false;
    }

    for (const timeSlot of todaySchedule.times) {
      // IMPORTANT: workingHours are stored in UTC, so we need to:
      // 1. Create UTC time objects from the stored times
      // 2. Convert them to the user's timezone for comparison
      // 3. Handle date boundaries properly for overnight shifts

      // For overnight shifts, we need to check both current day and previous day
      // because working hours like 11:00 PM - 11:30 PM span across midnight
      const currentDate = now.format('YYYY-MM-DD');
      const previousDate = now.subtract(1, 'day').format('YYYY-MM-DD');

      // Try current date first
      let fromUTC = dayjs.utc(`${currentDate} ${timeSlot.from}`);
      let toUTC = dayjs.utc(`${currentDate} ${timeSlot.to}`);

      // Convert UTC times to user's timezone for display and comparison
      let fromLocal = fromUTC.tz(userTimezone);
      let toLocal = toUTC.tz(userTimezone);

      // Handle overnight shift: e.g., from 23:00 to 06:00
      // Check if the time slot spans to the next day in the local timezone
      if (toLocal.isBefore(fromLocal)) {
        toLocal = toLocal.add(1, 'day');
        console.log(`🌙 Overnight shift detected: ${timeSlot.from}-${timeSlot.to} UTC → ${fromLocal.format('HH:mm')}-${toLocal.format('HH:mm')} ${userTimezone} (next day)`);
      }

      // Check if current time falls within this slot
      let isWithinSlot = false;
      const fromLocalDate = fromLocal.format('YYYY-MM-DD');
      const toLocalDate = toLocal.format('YYYY-MM-DD');

      if (fromLocalDate === toLocalDate) {
        // Same day slot
        isWithinSlot = now.isAfter(fromLocal) && now.isBefore(toLocal);
      } else {
        // Cross-day slot (e.g., 11:00 PM to 6:00 AM next day)
        // Check if current time is after start time OR before end time
        isWithinSlot = now.isAfter(fromLocal) || now.isBefore(toLocal);
      }

      // If not within current date slot, try previous date slot
      if (!isWithinSlot) {
        console.log(`🔄 Trying previous day slot for overnight working hours...`);

        // Try with previous date as base
        fromUTC = dayjs.utc(`${previousDate} ${timeSlot.from}`);
        toUTC = dayjs.utc(`${previousDate} ${timeSlot.to}`);

        fromLocal = fromUTC.tz(userTimezone);
        toLocal = toUTC.tz(userTimezone);

        // Handle overnight shift for previous day
        if (toLocal.isBefore(fromLocal)) {
          toLocal = toLocal.add(1, 'day');
        }

        const fromLocalDatePrev = fromLocal.format('YYYY-MM-DD');
        const toLocalDatePrev = toLocal.format('YYYY-MM-DD');

        if (fromLocalDatePrev === toLocalDatePrev) {
          // Same day slot
          isWithinSlot = now.isAfter(fromLocal) && now.isBefore(toLocal);
        } else {
          // Cross-day slot
          isWithinSlot = now.isAfter(fromLocal) || now.isBefore(toLocal);
        }

        if (isWithinSlot) {
          console.log(`✅ Current time is within previous day's working hours slot`);
        }
      }

      console.log(`⏰ Checking time slot: ${timeSlot.from}-${timeSlot.to} UTC → ${fromLocal.format('HH:mm')}-${toLocal.format('HH:mm')} ${userTimezone}`);
      console.log(`   - From (UTC): ${fromUTC.format('YYYY-MM-DD HH:mm:ss')} UTC`);
      console.log(`   - From (local): ${fromLocal.format('YYYY-MM-DD HH:mm:ss')} ${userTimezone}`);
      console.log(`   - To (UTC): ${toUTC.format('YYYY-MM-DD HH:mm:ss')} UTC`);
      console.log(`   - To (local): ${toLocal.format('YYYY-MM-DD HH:mm:ss')} ${userTimezone}`);
      console.log(`   - Current (local): ${now.format('YYYY-MM-DD HH:mm:ss')} ${userTimezone}`);
      console.log(`   - Date comparison: ${fromLocalDate} to ${toLocalDate} vs current ${currentDate}`);

      if (isWithinSlot) {
        console.log(`✅ Current time is within this slot`);
        return true;
      } else {
        console.log(`❌ Current time is outside this slot`);
      }
    }
    console.log(`❌ Current time is not within any working hours slot`);
    return false;
  } catch (error) {
    console.error(`❌ Error checking working hours for timezone ${userTimezone}:`, error);
    console.log(`🔄 Falling back to server timezone check`);
    // Fallback to server timezone if timezone processing fails
    return isWithinWorkingHours(workingHours);
  }
};

export const handleFallbackMaterial = async (
  defaultActionSettings: DefaultActionSettings | null,
  recipient: string,
  agentPhoneNumberId: string | undefined
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
        recipient,
        1,
        agentPhoneNumberId
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
