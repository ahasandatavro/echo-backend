

import { Request, Response } from "express";
import axios from "axios";
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { prisma } from "../models/prismaClient";

export const getAnalytics = async (req: Request, res: Response) => {
  try {
    const businessId = process.env.META_WHATSAPP_BUSINESS_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!businessId || !accessToken) {
      return res.status(400).json({ message: "Missing Meta API credentials" });
    }

    // ✅ Calculate Time Periods
    const now = new Date();
    const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const startTimestamp = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60; // Last 30 days
    const endTimestamp = Math.floor(Date.now() / 1000);

    const startMonthTimestamp = Math.floor(firstDayLastMonth.getTime() / 1000); // First day of last month
    const endMonthTimestamp = Math.floor(lastDayLastMonth.getTime() / 1000); // Last day of last month

    // ✅ API Request URLs
    const analyticsUrl = `https://graph.facebook.com/v22.0/${businessId}?fields=analytics.start(${startTimestamp}).end(${endTimestamp}).granularity(DAY)`;

    const conversationAnalyticsUrl = `https://graph.facebook.com/v22.0/${businessId}?fields=conversation_analytics.start(${startMonthTimestamp}).end(${endMonthTimestamp}).granularity(MONTHLY)&access_token=${accessToken}`;

    //const pricingAnalyticsUrl = `https://graph.facebook.com/v22.0/${businessId}?fields=pricing_analytics.start(${startMonthTimestamp}).end(${endMonthTimestamp}).granularity(MONTHLY).metric_types([]).phone_numbers([]).country_codes([]).metric_types(["COST","VOLUME"]).pricing_types([]).pricing_categories([]).dimensions([])&access_token=${accessToken}`;

    const templateAnalyticsUrl = `https://graph.facebook.com/v22.0/${businessId}/template_analytics?start=${startTimestamp}&end=${endTimestamp}&granularity=daily&template_ids=[420408940394378]&access_token=${accessToken}`;

    // ✅ Fetch Data from Meta API
    const [analyticsRes, conversationAnalyticsRes,templateAnalyticsRes] = await Promise.all([
      axios.get(analyticsUrl, { headers: { Authorization: `Bearer ${accessToken}` } }),
      axios.get(conversationAnalyticsUrl, { headers: { Authorization: `Bearer ${accessToken}` } }),
       //axios.get(pricingAnalyticsUrl, { headers: { Authorization: `Bearer ${accessToken}` } }),
       axios.get(templateAnalyticsUrl, { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);

    // ✅ Extract Data
    const analyticsData = analyticsRes.data.analytics?.data_points || [];
    const conversationData = conversationAnalyticsRes.data.data_points || [];
    //const pricingData = pricingAnalyticsRes.data.pricing_analytics?.data_points || [];
    const templateData = templateAnalyticsRes.data?.data || [];
    const pricingData:any[] =[];
    //const templateData:any[]=[];
    // ✅ Aggregate Messages Sent & Delivered
    let totalMessagesSent = 0;
    let totalMessagesDelivered = 0;

    analyticsData.forEach((entry: any) => {
      totalMessagesSent += entry.sent || 0;
      totalMessagesDelivered += entry.delivered || 0;
    });

    // ✅ Aggregate Conversation Analytics
    let totalConversations = 0;
    let businessInitiated = 0;
    let userInitiated = 0;
    let freeConversations = 0;
    let paidConversations = 0;

    conversationData.forEach((entry: any) => {
      totalConversations += entry.value || 0;

      if (entry.CONVERSATION_TYPE === "business_initiated") {
        businessInitiated += entry.value || 0;
      }
      if (entry.CONVERSATION_TYPE === "user_initiated") {
        userInitiated += entry.value || 0;
      }

      if (entry.CONVERSATION_CATEGORY === "free") {
        freeConversations += entry.value || 0;
      } else {
        paidConversations += entry.value || 0;
      }
    });

    // ✅ Extract Pricing Data
    let pricingDetails: Record<string, any> = {};
    pricingData.forEach((entry: any) => {
      const country = entry.COUNTRY || "Unknown";
      const phone = entry.PHONE || "Unknown";
      const metricType = entry.METRIC_TYPE || "Unknown";

      if (!pricingDetails[country]) pricingDetails[country] = {};
      if (!pricingDetails[country][phone]) pricingDetails[country][phone] = {};

      pricingDetails[country][phone][metricType] = entry.value;
    });

    const allowedMetrics = ["sent", "delivered", "read", "amount_spent", "cost_per_delivered", "cost_per_url_button_click"] as const;
    type MetricType = (typeof allowedMetrics)[number];  // Restrict type to valid metric names
    
    let templateMetrics: Record<MetricType, number> = {
        sent: 0,
        delivered: 0,
        read: 0,
        amount_spent: 0,
        cost_per_delivered: 0,
        cost_per_url_button_click: 0,
      };
    
      templateData.forEach((entry: any) => {
        // ✅ Direct Metrics (sent, delivered, read)
        ["sent", "delivered", "read"].forEach((metric) => {
          if (entry[metric] !== undefined) {
            templateMetrics[metric as MetricType] += entry[metric];
          }
        });
      
        // ✅ Handle Cost Array Separately
        if (Array.isArray(entry.cost)) {
          entry.cost.forEach((costItem: any) => {
            if (allowedMetrics.includes(costItem.type as MetricType)) {
              templateMetrics[costItem.type as MetricType] += costItem.value || 0; // Default to 0 if value is missing
            }
          });
        }
      });

    // ✅ Calculate Costs
    const businessInitiatedCost = businessInitiated * 2.03;
    const userInitiatedCost = userInitiated * 5.03;
    const totalCost = businessInitiatedCost + userInitiatedCost;

    // ✅ Response Format for Graph Representation
    res.json({
      totalMessagesSent,
      totalMessagesDelivered,
      totalConversations,
      businessInitiated,
      userInitiated,
      freeConversations,
      paidConversations,
      businessInitiatedCost,
      userInitiatedCost,
      totalCost,
      pricingDetails,
      templateMetrics,
    });
  } catch (error: any) {
    console.error("Error fetching WhatsApp Business analytics:", error?.response?.data || error.message);
    res.status(500).json({ message: "Error fetching analytics from Meta API" });
  }
};

export const getUserAnalytics = async (req: Request, res: Response) => {
  try {
    // 1. Parse and validate query parameters
    const chatbotName = req.query.chatbot as string;
    const userType = req.query.userType as string;
    const timeRange = req.query.timeRange as string;
    const countriesParam = req.query.countries as string;
    const attributesParam = req.query.attributes as string;
    if (!chatbotName || !userType || !timeRange) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    // Parse countries
    const countries = countriesParam ? countriesParam.split(',').map(c => c.trim().toLowerCase()) : [];
    // Parse attributes
    let attributes: Record<string, string[]> = {};
    if (attributesParam) {
      try {
        attributes = JSON.parse(attributesParam);
      } catch {
        return res.status(400).json({ error: 'Invalid attributes JSON' });
      }
    }
    // 2. Determine the time range
    const now = new Date();
    let startDate: Date, endDate: Date;
    if (timeRange === 'Last 6 months') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (timeRange === 'Last 30 days') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      endDate = now;
    } else if (timeRange === 'Last 7 days') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      endDate = now;
    } else if (timeRange === 'This month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
      return res.status(400).json({ error: 'Invalid timeRange' });
    }
    // 3. Get the current user's selectedPhoneNumberId from JWT
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    });
    if (!dbUser || !dbUser.selectedPhoneNumberId) {
      return res.status(400).json({ error: 'User does not have a selectedPhoneNumberId' });
    }
    // Convert selectedPhoneNumberId to number if possible
    const selectedPhoneNumberId = (dbUser.selectedPhoneNumberId);
 
    // 4. Find the chatbotId by chatbot name
    const chatbot = await prisma.chatbot.findFirst({ where: { id: parseInt(chatbotName) }, select: { id: true } });
    if (!chatbot) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }
    const chatbotId = chatbot.id;
    const bp=await prisma.businessPhoneNumber.findFirst({where:{metaPhoneNumberId:selectedPhoneNumberId},select:{id:true}});
    if(!bp){
      return res.status(404).json({ error: 'Business Phone Number not found' });
    }
    const businessPhoneNumberId=bp.id;
    // 5. Query all conversations with filters
    const conversations = await prisma.conversation.findMany({
      where: {
        chatbotId,
        businessPhoneNumberId: businessPhoneNumberId,
        OR: [
          { createdAt: { gte: startDate, lte: endDate } },
          { updatedAt: { gte: startDate, lte: endDate } }
        ],
      },
      // Remove include: { contact: true },
    });
    // For each conversation, fetch the contact by phoneNumber (recipient)
    const conversationsWithContact = await Promise.all(
      conversations.map(async (conv) => {
        const contact = await prisma.contact.findFirst({ where: { phoneNumber: conv.recipient } });
        return { ...conv, contact };
      })
    );
    // 6. Filter by country and attributes
    const filteredConversations = conversationsWithContact.filter((conv) => {
      const contact = conv.contact;
      if (!contact) return false;
      // Country filter
      if (countries.length > 0) {
        let phone = contact.phoneNumber;
        if (!phone.startsWith('+')) phone = '+' + phone;
        try {
          const phoneNumber = parsePhoneNumberFromString(phone);
          if (!phoneNumber || !phoneNumber.country) return false;
          const countryName = countryCodeToName[phoneNumber.country];
          if (!countryName || !countries.includes(countryName.toLowerCase())) return false;
        } catch {
          return false;
        }
      }
      // Attributes filter (AND logic)
      let contactAttrs: Record<string, any> = {};
      if (contact.attributes && typeof contact.attributes === 'object' && !Array.isArray(contact.attributes)) {
        contactAttrs = contact.attributes as Record<string, any>;
      }
      for (const [key, values] of Object.entries(attributes)) {
        if (!Array.isArray(values)) return false;
        if (!contactAttrs[key] || !values.includes(contactAttrs[key])) return false;
      }
      return true;
    });
    // 7. User Type Filtering
    let finalConversations: typeof filteredConversations = [];
    
    if (userType === 'All Users') {
      // Include all conversations
      finalConversations = filteredConversations;
    } else if (userType === 'New Users') {
      // Get all conversations for this businessPhoneNumberId (across all chatbots)
      const allConversationsForBusiness = await prisma.conversation.findMany({
        where: {
          businessPhoneNumberId: businessPhoneNumberId,
          OR: [
            { createdAt: { gte: startDate, lte: endDate } },
            { updatedAt: { gte: startDate, lte: endDate } }
          ],
        },
      });
      
      // Group conversations by contact phone number across all chatbots
      const convsByContactPhone: Record<string, any[]> = {};
      for (const conv of allConversationsForBusiness) {
        if (!convsByContactPhone[conv.recipient]) {
          convsByContactPhone[conv.recipient] = [];
        }
        convsByContactPhone[conv.recipient].push(conv);
      }
      
      // Get contacts who have conversations ONLY with this chatbot (no other chatbots)
      const newUserContactPhones = Object.keys(convsByContactPhone).filter(phone => {
        const convs = convsByContactPhone[phone];
        // Check if this contact has conversations with ONLY this chatbot
        const uniqueChatbotIds = [...new Set(convs.map(c => c.chatbotId))];
        return uniqueChatbotIds.length === 1 && uniqueChatbotIds[0] === chatbotId;
      });
      
      // Filter conversations to only include those from new users
      finalConversations = filteredConversations.filter(conv => 
        newUserContactPhones.includes(conv.recipient)
      );
    } else if (userType === 'Returning Users') {
      // Get all conversations for this businessPhoneNumberId (across all chatbots)
      const allConversationsForBusiness = await prisma.conversation.findMany({
        where: {
          businessPhoneNumberId: businessPhoneNumberId,
          OR: [
            { createdAt: { gte: startDate, lte: endDate } },
            { updatedAt: { gte: startDate, lte: endDate } }
          ],
        },
      });
      
      // Group conversations by contact phone number across all chatbots
      const convsByContactPhone: Record<string, any[]> = {};
      for (const conv of allConversationsForBusiness) {
        if (!convsByContactPhone[conv.recipient]) {
          convsByContactPhone[conv.recipient] = [];
        }
        convsByContactPhone[conv.recipient].push(conv);
      }
      
      // Get contacts who have conversations with multiple chatbots (including current one)
      const returningContactPhones = Object.keys(convsByContactPhone).filter(phone => {
        const convs = convsByContactPhone[phone];
        // Check if this contact has conversations with multiple chatbots
        const uniqueChatbotIds = [...new Set(convs.map(c => c.chatbotId))];
        return uniqueChatbotIds.length > 1;
      });
      
      // Filter conversations to only include those from returning contacts
      finalConversations = filteredConversations.filter(conv => 
        returningContactPhones.includes(conv.recipient)
      );
    } else {
      return res.status(400).json({ error: 'Invalid userType' });
    }
    // 8. Aggregate by hour
    const hourCounts = Array(24).fill(0);
    for (const conv of finalConversations) {
      const hour = conv.createdAt.getHours();
      hourCounts[hour]++;
    }
    // 9. Format response
    const labels = [
      '12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM',
      '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'
    ];
    res.json({
      labels,
      datasets: [
        {
          label: 'Number of Users',
          data: hourCounts,
        },
      ],
    });
  } catch (error) {
    console.error('Error in getUserAnalytics:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getChatbotAnalytics = async (req: Request, res: Response) => {
  try {
    const { timeRange, chatbotId } = req.query;
    // 1. Parse time range
    const now = new Date();
    let startDate: Date, endDate: Date;
    if (timeRange === 'Last 6 months') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (timeRange === 'Last 30 days') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      endDate = now;
    } else if (timeRange === 'Last 7 days') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      endDate = now;
    } else if (timeRange === 'This month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
      return res.status(400).json({ error: 'Invalid timeRange' });
    }
    
    // 2. Get the current user's selectedPhoneNumberId from JWT
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { id: true, selectedPhoneNumberId: true },
    });
    if (!dbUser || !dbUser.selectedPhoneNumberId) {
      return res.status(400).json({ error: 'User does not have a selectedPhoneNumberId' });
    }
    
    const selectedPhoneNumberId = (dbUser.selectedPhoneNumberId);
    const bp = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: selectedPhoneNumberId },
      select: { id: true }
    });
    if (!bp) {
      return res.status(404).json({ error: 'Business Phone Number not found' });
    }
    const businessPhoneNumberId = bp.id;
    
    // 3. Get chatbots that had conversations within the time range for this business phone number
    let chatbotWhere: any = {};
    if (chatbotId && chatbotId !== 'all') {
      chatbotWhere = { id: parseInt(chatbotId as string, 10) };
    }
    
    // Get chatbots owned by the user that have conversations in the time range
    const chatbotsWithConversations = await prisma.chatbot.findMany({
      where: {
        ownerId: dbUser.id,
        ...(chatbotId && chatbotId !== 'all' ? { id: parseInt(chatbotId as string, 10) } : {}),
        conversations: {
          some: {
            businessPhoneNumberId: businessPhoneNumberId,
            OR: [
              { createdAt: { gte: startDate, lte: endDate } },
              { updatedAt: { gte: startDate, lte: endDate } }
            ]
          }
        }
      },
      select: {
        id: true,
        name: true
      }
    });
    
    const chatbots = chatbotsWithConversations;
    // 3. For each chatbot, calculate analytics
    const analytics = await Promise.all(chatbots.map(async (chatbot) => {
      // Get all nodes for this chatbot
      const nodes = await prisma.node.findMany({ where: { chatId: chatbot.id } });
      const totalNodes = nodes.length;
      // Get all conversations for this chatbot in time range
      const conversations = await prisma.conversation.findMany({
        where: {
          chatbotId: chatbot.id,
          createdAt: { gte: startDate, lte: endDate },
        },
        include: { contact: true },
      });
      // Unique users (contacts)
      const userMap = new Map();
      conversations.forEach((conv) => {
        if (conv.contactId) userMap.set(conv.contactId, conv);
      });
      const totalUsers = userMap.size;
      // Completed users: those whose lastNodeId equals the last node in the flow
      let completedUsers = 0;
      let dropoffUsers = 0;
      let lastNodeId: number | undefined = undefined;
      if (nodes.length > 0) {
        // Heuristic: last node = node with no outgoing edges
        const nodeIds = nodes.map((n) => n.id);
        const edges = await prisma.edge.findMany({ where: { chatId: chatbot.id } });
        const sourceIds = new Set(edges.map((e) => e.sourceId));
        const lastNodes = nodeIds.filter((id) => !sourceIds.has(id));
        lastNodeId = lastNodes.length>= 1 ? lastNodes[0] : undefined;
      }
      userMap.forEach((conv) => {
        if (lastNodeId && conv.lastNodeId === lastNodeId) {
          completedUsers++;
        } else {
          dropoffUsers++;
        }
      });
      const completedPercentage = totalUsers > 0 ? Math.round((completedUsers / totalUsers) * 100) : 0;
      const dropoffRate = totalUsers > 0 ? Math.round((dropoffUsers / totalUsers) * 100) : 0;
      return {
        id: chatbot.id.toString(),
        name: chatbot.name,
        totalNodes,
        totalUsers,
        completedUsers,
        completedPercentage,
        dropoffUsers,
        dropoffRate,
      };
    }));
    res.json({ analytics });
  } catch (error) {
    console.error('Error in getChatbotAnalytics:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getBroadcastAnalytics = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const { phoneNumberId, broadcastId, timeRange } = req.query;

    // Parse time range
    const now = new Date();
    let startDate: Date;
    
    switch (timeRange) {
      case 'last_7_days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'last_30_days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'last_90_days':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Build filter conditions
    const whereConditions: any = {
      userId: user.userId,
      createdAt: {
        gte: startDate,
        lte: now
      }
    };

    if (phoneNumberId) {
      whereConditions.phoneNumberId = phoneNumberId as string;
    }

    if (broadcastId) {
      whereConditions.id = parseInt(broadcastId as string);
    }

    // Get broadcasts with metrics
    const broadcasts = await prisma.broadcast.findMany({
      where: whereConditions,
      include: {
        recipients: {
          include: {
            contact: {
              select: { name: true, phoneNumber: true }
            }
          }
        },
        metrics: {
          select: {
            metricType: true,
            metricValue: true,
            timestamp: true,
            contactId: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Process broadcast analytics
    const broadcastAnalytics = broadcasts.map(broadcast => {
      // Calculate metrics from the metrics table
      const metricsData = broadcast.metrics.reduce((acc: any, metric) => {
        if (!acc[metric.metricType]) {
          acc[metric.metricType] = 0;
        }
        acc[metric.metricType] += metric.metricValue;
        return acc;
      }, {});

      // Calculate rates
      const totalSent = broadcast.totalSent || metricsData.sent || broadcast.recipients.length;
      const totalDelivered = broadcast.totalDelivered || metricsData.delivered || 0;
      const totalRead = broadcast.totalRead || metricsData.read || 0;
      const totalClicked = broadcast.totalClicked || metricsData.clicked || 0;
      const totalReplied = broadcast.totalReplied || metricsData.replied || 0;
      const websiteClicks = broadcast.websiteClicks || 0;

      const deliveryRate = totalSent > 0 ? ((totalDelivered / totalSent) * 100).toFixed(2) : '0.00';
      const readRate = totalDelivered > 0 ? ((totalRead / totalDelivered) * 100).toFixed(2) : '0.00';
      const clickRate = totalDelivered > 0 ? ((totalClicked / totalDelivered) * 100).toFixed(2) : '0.00';
      const replyRate = totalDelivered > 0 ? ((totalReplied / totalDelivered) * 100).toFixed(2) : '0.00';

      return {
        id: broadcast.id,
        name: broadcast.name,
        templateName: broadcast.templateName,
        phoneNumberId: broadcast.phoneNumberId,
        apiType: broadcast.apiType,
        status: broadcast.status,
        createdAt: broadcast.createdAt,
        sentAt: broadcast.sentAt,
        recipients: broadcast.recipients.length,
        metrics: {
          totalSent,
          totalDelivered,
          totalRead,
          totalClicked,
          totalReplied,
          websiteClicks,
          deliveryRate: parseFloat(deliveryRate),
          readRate: parseFloat(readRate),
          clickRate: parseFloat(clickRate),
          replyRate: parseFloat(replyRate)
        },
        buttonClicks: broadcast.buttonClicks || {},
        recipientDetails: broadcast.recipients.map(recipient => ({
          contactId: recipient.contactId,
          name: recipient.contact.name,
          phoneNumber: recipient.contact.phoneNumber,
          status: recipient.status,
          errorMessage: recipient.errorMessage
        }))
      };
    });

    // Calculate summary metrics
    const summary = {
      totalBroadcasts: broadcasts.length,
      totalRecipients: broadcasts.reduce((sum, b) => sum + b.recipients.length, 0),
      totalSent: broadcasts.reduce((sum, b) => sum + (b.totalSent || 0), 0),
      totalDelivered: broadcasts.reduce((sum, b) => sum + (b.totalDelivered || 0), 0),
      totalRead: broadcasts.reduce((sum, b) => sum + (b.totalRead || 0), 0),
      totalClicked: broadcasts.reduce((sum, b) => sum + (b.totalClicked || 0), 0),
      totalReplied: broadcasts.reduce((sum, b) => sum + (b.totalReplied || 0), 0),
      totalWebsiteClicks: broadcasts.reduce((sum, b) => sum + (b.websiteClicks || 0), 0),
      avgDeliveryRate: 0,
      avgReadRate: 0,
      avgClickRate: 0,
      avgReplyRate: 0,
    };

    // Calculate overall rates
    summary.avgDeliveryRate = summary.totalSent > 0 
      ? parseFloat(((summary.totalDelivered / summary.totalSent) * 100).toFixed(2))
      : 0;
    
    summary.avgReadRate = summary.totalDelivered > 0 
      ? parseFloat(((summary.totalRead / summary.totalDelivered) * 100).toFixed(2))
      : 0;
    
    summary.avgClickRate = summary.totalDelivered > 0 
      ? parseFloat(((summary.totalClicked / summary.totalDelivered) * 100).toFixed(2))
      : 0;
    
    summary.avgReplyRate = summary.totalDelivered > 0 
      ? parseFloat(((summary.totalReplied / summary.totalDelivered) * 100).toFixed(2))
      : 0;

    res.json({
      success: true,
      summary,
      broadcasts: broadcastAnalytics,
      timeRange,
      phoneNumberId: phoneNumberId || 'all'
    });

  } catch (error) {
    console.error('Error in getBroadcastAnalytics:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const getChatbotNodeAnalytics = async (req: Request, res: Response) => {
  try {
    const { chatbotId } = req.params;
    const { timeRange } = req.query;
    if (!chatbotId) {
      return res.status(400).json({ error: 'Missing chatbotId parameter' });
    }
    // Parse time range
    const now = new Date();
    let startDate: Date, endDate: Date;
    if (timeRange === 'Last 6 months') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (timeRange === 'Last 30 days') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      endDate = now;
    } else if (timeRange === 'Last 7 days') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      endDate = now;
    } else if (timeRange === 'This month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
      // Default: last 30 days
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      endDate = now;
    }
    // Fetch chatbot and nodes
    const chatbot = await prisma.chatbot.findUnique({ where: { id: parseInt(chatbotId, 10) } });
    if (!chatbot) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }
    const nodes = await prisma.node.findMany({ where: { chatId: chatbot.id } });
    // Fetch all NodeVisits for this chatbot in the time range
    const nodeVisits = await prisma.nodeVisit.findMany({
      where: {
        node: { chatId: chatbot.id },
        enteredAt: { gte: startDate, lte: endDate },
      },
      include: { node: true, conversation: true },
    });
    // Total unique users for this chatbot
    const totalChatbotUsers = new Set(nodeVisits.map(v => v.contactId)).size;
    // For each node, calculate analytics
    const nodeAnalytics = await Promise.all(nodes.map(async (node) => {
      // NodeVisits for this node
      const visitsForNode = nodeVisits.filter(v => v.nodeId === node.id);
      // Users who reached this node
      const usersReached = new Set(visitsForNode.map(v => v.contactId));
      const totalUsersReached = usersReached.size;
      // Drop-off users: users whose last NodeVisit in their conversation is this node
      const dropoffUsersSet = new Set();
      const visitsByConversation = new Map();
      visitsForNode.forEach(v => {
        if (!visitsByConversation.has(v.conversationId)) visitsByConversation.set(v.conversationId, []);
        visitsByConversation.get(v.conversationId).push(v);
      });
      for (const [conversationId, visits] of visitsByConversation.entries()) {
        // Find all visits for this conversation
        const allVisits = nodeVisits.filter(v => v.conversationId === conversationId);
        // Find the last visit (by enteredAt)
        const lastVisit = allVisits.reduce((a, b) => (a.enteredAt > b.enteredAt ? a : b));
        if (lastVisit.nodeId === node.id && lastVisit.contactId) {
          dropoffUsersSet.add(lastVisit.contactId);
        }
      }
      const dropoffUsers = dropoffUsersSet.size;
      const dropoffRate = totalUsersReached > 0 ? Math.round((dropoffUsers / totalUsersReached) * 100) : 0;
      // Avg. time spent: average (leftAt - enteredAt) for this node
      const timeDiffs = visitsForNode
        .filter(v => v.leftAt !== null && v.enteredAt)
        .map(v => v.leftAt && v.enteredAt ? (v.leftAt.getTime() - v.enteredAt.getTime()) / 1000 : 0); // seconds
      const avgTimeSpent = timeDiffs.length > 0 ? (timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length) : null;
      return {
        nodeId: node.id,
        nodeType: node.type,
        nodeData: node.data,
        focusX: node.positionX,
        focusY: node.positionY,
        totalChatbotUsers,
        totalUsersReached,
        dropoffUsers,
        dropoffRate,
        avgTimeSpent,
      };
    }));
    res.json({ nodes: nodeAnalytics });
  } catch (error) {
    console.error('Error in getChatbotNodeAnalytics:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getTemplatePerformanceTrend = async (req: Request, res: Response) => {
  try {
    const { templateId, date } = req.query;
    
    // Validate required parameters
    if (!templateId || !date) {
      return res.status(400).json({ 
        success: false, 
        message: "templateId and date are required" 
      });
    }

    // Get user's selected WABA ID from JWT
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedWabaId: true },
    });

    if (!dbUser?.selectedWabaId) {
      return res.status(400).json({ 
        success: false, 
        message: "No WABA ID selected for this user" 
      });
    }

    // Fetch the template from database to get the WhatsApp template ID
    const template = await prisma.template.findFirst({
      where: { 
        id: parseInt(templateId as string),
        userId: user.userId,
        wabaId: dbUser.selectedWabaId
      },
      select: { content: true }
    });

    if (!template) {
      return res.status(404).json({ 
        success: false, 
        message: "Template not found" 
      });
    }

    // Parse the content to get the WhatsApp template ID
    let whatsappTemplateId: string;
    try {
      if (!template.content) {
        return res.status(400).json({ 
          success: false, 
          message: "Template content is missing" 
        });
      }
      
      const templateContent = JSON.parse(template.content);
      whatsappTemplateId = templateContent.id;
      
      if (!whatsappTemplateId) {
        return res.status(400).json({ 
          success: false, 
          message: "Template does not have a valid WhatsApp template ID" 
        });
      }
    } catch (error) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid template content format" 
      });
    }

    // Parse the date and calculate ±5 minutes range
    const targetDate = new Date(date as string);
    
    // Check if the date is valid
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid date format" 
      });
    }
    
    // Check if the date is in the future (Meta API doesn't accept future dates)
    const now = new Date();
    if (targetDate > now) {
      console.log('Future date detected, using current date instead');
      // Use current date instead of future date
      targetDate.setTime(now.getTime());
    }
    
    // For daily granularity, Meta API automatically corrects to 0:00 UTC
    // So we need to use the start and end of the target date in UTC
    const targetDateUTC = new Date(targetDate.getTime());
    targetDateUTC.setUTCHours(0, 0, 0, 0); // Set to 00:00:00 UTC
    
    const startDate = new Date(targetDateUTC.getTime());
    const endDate = new Date(targetDateUTC.getTime() + 24 * 60 * 60 * 1000); // Next day 00:00:00 UTC
    
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);
    
    console.log('Date Debug:', {
      originalDate: date,
      targetDate: targetDate.toISOString(),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      startTimestamp,
      endTimestamp
    });

    const selectedWabaId = dbUser.selectedWabaId;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!accessToken) {
      return res.status(500).json({ 
        success: false, 
        message: "Meta access token not configured" 
      });
    }

    // Call Meta API for template analytics
    const templateAnalyticsUrl = `https://graph.facebook.com/v23.0/${selectedWabaId}/template_analytics?start=${startTimestamp}&end=${startTimestamp}&granularity=daily&metric_types=cost,clicked,delivered,read,sent&template_ids=[${whatsappTemplateId}]`;

    const response = await axios.get(templateAnalyticsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const templateData = response.data?.data[0]?.data_points || [];
    
    if (templateData.length === 0) {
      return res.json({
        success: true,
        data: {
          financialMetrics: {
            amountSpent: 0,
            costPerMessageDelivered: 0,
            costPerWebsiteButtonClick: 0,
            currency: "INR"
          },
          performanceMetrics: {
            messagesSent: 0,
            messagesDelivered: 0,
            messagesRead: 0,
            replies: 0,
            readPercentage: 0
          },
          performanceTrend: {
            labels: [],
            datasets: []
          },
          buttonClicks: {
            summary: {},
            tableData: {
              total: [],
              unique: []
            },
            graphData: {
              labels: [],
              datasets: []
            }
          }
        }
      });
    }

    // Process the data
    const processedData = processTemplateAnalyticsData(templateData, targetDate);

    res.json({
      success: true,
      data: processedData
    });

  } catch (error: any) {
    console.error("Error fetching template analytics:", error?.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      message: "Error fetching template analytics from Meta API" 
    });
  }
};

const processTemplateAnalyticsData = (templateData: any[], targetDate: Date) => {
  // Initialize metrics
  let totalSent = 0;
  let totalDelivered = 0;
  let totalRead = 0;
  let totalReplies = 0;
  let amountSpent = 0;
  let costPerDelivered = 0;
  let costPerUrlButtonClick = 0;
  let currency = "INR";
  
  const buttonClicks: Record<string, any> = {};
  const dailyData: Record<string, any> = {};

  // Process each data point
  templateData.forEach((entry: any) => {
    // Aggregate basic metrics
    totalSent += entry.sent || 0;
    totalDelivered += entry.delivered || 0;
    totalRead += entry.read || 0;

    // Process cost metrics
    if (Array.isArray(entry.cost)) {
      entry.cost.forEach((costItem: any) => {
        if (costItem.type === "amount_spent") {
          amountSpent += costItem.value || 0;
        } else if (costItem.type === "cost_per_delivered") {
          costPerDelivered += costItem.value || 0;
        } else if (costItem.type === "cost_per_url_button_click") {
          costPerUrlButtonClick += costItem.value || 0;
        }
      });
    }

    // Process button clicks
    if (Array.isArray(entry.clicked)) {
      entry.clicked.forEach((clickItem: any) => {
        const buttonLabel = clickItem.button_content || "Unknown";
        const clickType = clickItem.type === "unique_url_button" ? "unique" : "total";
        
        if (!buttonClicks[buttonLabel]) {
          buttonClicks[buttonLabel] = { total: 0, unique: 0 };
        }
        
        if (clickType === "unique") {
          buttonClicks[buttonLabel].unique += clickItem.count || 0;
        } else {
          buttonClicks[buttonLabel].total += clickItem.count || 0;
        }
      });
    }

    // Store daily data for trend analysis
    const dateKey = new Date(entry.start * 1000).toISOString().split('T')[0];
    if (!dailyData[dateKey]) {
      dailyData[dateKey] = { sent: 0, delivered: 0, read: 0, replies: 0 };
    }
    dailyData[dateKey].sent += entry.sent || 0;
    dailyData[dateKey].delivered += entry.delivered || 0;
    dailyData[dateKey].read += entry.read || 0;
  });

  // Generate date labels for the last 9 days
  const labels: string[] = [];
  const datasets = [
    { label: "Messages sent", data: [] as number[], borderColor: "#dc2626", backgroundColor: "rgba(220, 38, 38, 0.1)" },
    { label: "Messages delivered", data: [] as number[], borderColor: "#7c3aed", backgroundColor: "rgba(124, 58, 237, 0.1)" },
    { label: "Messages read", data: [] as number[], borderColor: "#0d9488", backgroundColor: "rgba(13, 148, 136, 0.1)" },
    { label: "Replies", data: [] as number[], borderColor: "#166534", backgroundColor: "rgba(22, 101, 52, 0.1)" }
  ];

  for (let i = 8; i >= 0; i--) {
    const date = new Date(targetDate);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    const label = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    
    labels.push(label);
    
    const dayData = dailyData[dateKey] || { sent: 0, delivered: 0, read: 0, replies: 0 };
    datasets[0].data.push(dayData.sent);
    datasets[1].data.push(dayData.delivered);
    datasets[2].data.push(dayData.read);
    datasets[3].data.push(dayData.replies);
  }

  // Process button clicks data
  const buttonSummary: Record<string, any> = {};
  const buttonTableData = { total: [] as any[], unique: [] as any[] };
  const buttonGraphData = {
    labels,
    datasets: [] as any[]
  };

  Object.entries(buttonClicks).forEach(([label, clicks]: [string, any]) => {
    const totalClicks = clicks.total;
    const uniqueClicks = clicks.unique;
    const clickRate = totalDelivered > 0 ? ((totalClicks / totalDelivered) * 100).toFixed(0) + "%" : "0%";
    const uniqueClickRate = totalDelivered > 0 ? ((uniqueClicks / totalDelivered) * 100).toFixed(0) + "%" : "0%";

    buttonSummary[label] = {
      label,
      type: "Website click",
      totalClicks,
      uniqueClicks,
      clickRate,
      uniqueClickRate
    };

    buttonTableData.total.push({
      label,
      type: "Website click",
      totalClicks,
      clicksVsPreviousPeriod: "--",
      clickRate
    });

    buttonTableData.unique.push({
      label,
      type: "Website click",
      totalClicks: uniqueClicks,
      clicksVsPreviousPeriod: "--",
      clickRate: uniqueClickRate
    });

    // Generate button click trend data
    const buttonTrendData: number[] = [];
    for (let i = 8; i >= 0; i--) {
      buttonTrendData.push(0); // Default to 0 for now, could be enhanced with actual daily data
    }

    buttonGraphData.datasets.push({
      label,
      totalData: buttonTrendData,
      uniqueData: buttonTrendData,
      borderColor: "#60a5fa",
      backgroundColor: "rgba(96, 165, 250, 0.1)"
    });
  });

  return {
    financialMetrics: {
      amountSpent: parseFloat(amountSpent.toFixed(2)),
      costPerMessageDelivered: parseFloat(costPerDelivered.toFixed(2)),
      costPerWebsiteButtonClick: parseFloat(costPerUrlButtonClick.toFixed(2)),
      currency
    },
    performanceMetrics: {
      messagesSent: totalSent,
      messagesDelivered: totalDelivered,
      messagesRead: totalRead,
      replies: totalReplies,
      readPercentage: totalDelivered > 0 ? Math.round((totalRead / totalDelivered) * 100) : 0
    },
    performanceTrend: {
      labels,
      datasets
    },
    buttonClicks: {
      summary: buttonSummary,
      tableData: buttonTableData,
      graphData: buttonGraphData
    }
  };
};

// Static map for country code to country name
const countryCodeToName: Record<string, string> = {
  AF: 'Afghanistan', AL: 'Albania', DZ: 'Algeria', AS: 'American Samoa', AD: 'Andorra', AO: 'Angola', AI: 'Anguilla', AQ: 'Antarctica', AG: 'Antigua and Barbuda', AR: 'Argentina', AM: 'Armenia', AW: 'Aruba', AU: 'Australia', AT: 'Austria', AZ: 'Azerbaijan', BS: 'Bahamas', BH: 'Bahrain', BD: 'Bangladesh', BB: 'Barbados', BY: 'Belarus', BE: 'Belgium', BZ: 'Belize', BJ: 'Benin', BM: 'Bermuda', BT: 'Bhutan', BO: 'Bolivia', BA: 'Bosnia and Herzegovina', BW: 'Botswana', BR: 'Brazil', IO: 'British Indian Ocean Territory', VG: 'British Virgin Islands', BN: 'Brunei', BG: 'Bulgaria', BF: 'Burkina Faso', BI: 'Burundi', KH: 'Cambodia', CM: 'Cameroon', CA: 'Canada', CV: 'Cape Verde', KY: 'Cayman Islands', CF: 'Central African Republic', TD: 'Chad', CL: 'Chile', CN: 'China', CX: 'Christmas Island', CC: 'Cocos Islands', CO: 'Colombia', KM: 'Comoros', CK: 'Cook Islands', CR: 'Costa Rica', HR: 'Croatia', CU: 'Cuba', CW: 'Curacao', CY: 'Cyprus', CZ: 'Czech Republic', CD: 'Democratic Republic of the Congo', DK: 'Denmark', DJ: 'Djibouti', DM: 'Dominica', DO: 'Dominican Republic', TL: 'East Timor', EC: 'Ecuador', EG: 'Egypt', SV: 'El Salvador', GQ: 'Equatorial Guinea', ER: 'Eritrea', EE: 'Estonia', ET: 'Ethiopia', FK: 'Falkland Islands', FO: 'Faroe Islands', FJ: 'Fiji', FI: 'Finland', FR: 'France', PF: 'French Polynesia', GA: 'Gabon', GM: 'Gambia', GE: 'Georgia', DE: 'Germany', GH: 'Ghana', GI: 'Gibraltar', GR: 'Greece', GL: 'Greenland', GD: 'Grenada', GU: 'Guam', GT: 'Guatemala', GG: 'Guernsey', GN: 'Guinea', GW: 'Guinea-Bissau', GY: 'Guyana', HT: 'Haiti', HN: 'Honduras', HK: 'Hong Kong', HU: 'Hungary', IS: 'Iceland', IN: 'India', ID: 'Indonesia', IR: 'Iran', IQ: 'Iraq', IE: 'Ireland', IM: 'Isle of Man', IL: 'Israel', IT: 'Italy', CI: 'Ivory Coast', JM: 'Jamaica', JP: 'Japan', JE: 'Jersey', JO: 'Jordan', KZ: 'Kazakhstan', KE: 'Kenya', KI: 'Kiribati', XK: 'Kosovo', KW: 'Kuwait', KG: 'Kyrgyzstan', LA: 'Laos', LV: 'Latvia', LB: 'Lebanon', LS: 'Lesotho', LR: 'Liberia', LY: 'Libya', LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg', MO: 'Macau', MK: 'Macedonia', MG: 'Madagascar', MW: 'Malawi', MY: 'Malaysia', MV: 'Maldives', ML: 'Mali', MT: 'Malta', MH: 'Marshall Islands', MR: 'Mauritania', MU: 'Mauritius', YT: 'Mayotte', MX: 'Mexico', FM: 'Micronesia', MD: 'Moldova', MC: 'Monaco', MN: 'Mongolia', ME: 'Montenegro', MS: 'Montserrat', MA: 'Morocco', MZ: 'Mozambique', MM: 'Myanmar', NA: 'Namibia', NR: 'Nauru', NP: 'Nepal', NL: 'Netherlands', AN: 'Netherlands Antilles', NC: 'New Caledonia', NZ: 'New Zealand', NI: 'Nicaragua', NE: 'Niger', NG: 'Nigeria', NU: 'Niue', KP: 'North Korea', MP: 'Northern Mariana Islands', NO: 'Norway', OM: 'Oman', PK: 'Pakistan', PW: 'Palau', PS: 'Palestine', PA: 'Panama', PG: 'Papua New Guinea', PY: 'Paraguay', PE: 'Peru', PH: 'Philippines', PN: 'Pitcairn', PL: 'Poland', PT: 'Portugal', PR: 'Puerto Rico', QA: 'Qatar', CG: 'Republic of the Congo', RE: 'Reunion', RO: 'Romania', RU: 'Russia', RW: 'Rwanda', BL: 'Saint Barthelemy', SH: 'Saint Helena', KN: 'Saint Kitts and Nevis', LC: 'Saint Lucia', MF: 'Saint Martin', PM: 'Saint Pierre and Miquelon', VC: 'Saint Vincent and the Grenadines', WS: 'Samoa', SM: 'San Marino', ST: 'Sao Tome and Principe', SA: 'Saudi Arabia', SN: 'Senegal', RS: 'Serbia', SC: 'Seychelles', SL: 'Sierra Leone', SG: 'Singapore', SX: 'Sint Maarten', SK: 'Slovakia', SI: 'Slovenia', SB: 'Solomon Islands', SO: 'Somalia', ZA: 'South Africa', KR: 'South Korea', SS: 'South Sudan', ES: 'Spain', LK: 'Sri Lanka', SD: 'Sudan', SR: 'Suriname', SJ: 'Svalbard and Jan Mayen', SZ: 'Swaziland', SE: 'Sweden', CH: 'Switzerland', SY: 'Syria', TW: 'Taiwan', TJ: 'Tajikistan', TZ: 'Tanzania', TH: 'Thailand', TG: 'Togo', TK: 'Tokelau', TO: 'Tonga', TT: 'Trinidad and Tobago', TN: 'Tunisia', TR: 'Turkey', TM: 'Turkmenistan', TC: 'Turks and Caicos Islands', TV: 'Tuvalu', UG: 'Uganda', UA: 'Ukraine', AE: 'United Arab Emirates', GB: 'United Kingdom', US: 'United States', UY: 'Uruguay', UZ: 'Uzbekistan', VU: 'Vanuatu', VA: 'Vatican', VE: 'Venezuela', VN: 'Vietnam', VI: 'Virgin Islands', YE: 'Yemen', ZM: 'Zambia', ZW: 'Zimbabwe'
};
