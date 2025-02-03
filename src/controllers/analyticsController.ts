

import { Request, Response } from "express";
import axios from "axios";

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
