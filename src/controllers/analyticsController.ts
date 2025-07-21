

import { Request, Response } from "express";
import axios from "axios";
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

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
        createdAt: { gte: startDate, lte: endDate },
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
    // Group conversations by contact.id
    const convsByContact: Record<number, typeof filteredConversations> = {};
    for (const conv of filteredConversations) {
      if (conv.contact && typeof conv.contact.id === 'number') {
        if (!convsByContact[conv.contact.id]) {
          convsByContact[conv.contact.id] = [];
        }
        convsByContact[conv.contact.id].push(conv);
      }
    }
    if (userType === 'New Users') {
      // Only contacts with exactly one conversation with this chatbot
      finalConversations = Object.values(convsByContact)
        .filter(convs => convs.length === 1)
        .flat();
    } else if (userType === 'Returning Users') {
      // Only contacts with more than one conversation with this chatbot
      finalConversations = Object.values(convsByContact)
        .filter(convs => convs.length > 1)
        .flat();
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

// Static map for country code to country name
const countryCodeToName: Record<string, string> = {
  AF: 'Afghanistan', AL: 'Albania', DZ: 'Algeria', AS: 'American Samoa', AD: 'Andorra', AO: 'Angola', AI: 'Anguilla', AQ: 'Antarctica', AG: 'Antigua and Barbuda', AR: 'Argentina', AM: 'Armenia', AW: 'Aruba', AU: 'Australia', AT: 'Austria', AZ: 'Azerbaijan', BS: 'Bahamas', BH: 'Bahrain', BD: 'Bangladesh', BB: 'Barbados', BY: 'Belarus', BE: 'Belgium', BZ: 'Belize', BJ: 'Benin', BM: 'Bermuda', BT: 'Bhutan', BO: 'Bolivia', BA: 'Bosnia and Herzegovina', BW: 'Botswana', BR: 'Brazil', IO: 'British Indian Ocean Territory', VG: 'British Virgin Islands', BN: 'Brunei', BG: 'Bulgaria', BF: 'Burkina Faso', BI: 'Burundi', KH: 'Cambodia', CM: 'Cameroon', CA: 'Canada', CV: 'Cape Verde', KY: 'Cayman Islands', CF: 'Central African Republic', TD: 'Chad', CL: 'Chile', CN: 'China', CX: 'Christmas Island', CC: 'Cocos Islands', CO: 'Colombia', KM: 'Comoros', CK: 'Cook Islands', CR: 'Costa Rica', HR: 'Croatia', CU: 'Cuba', CW: 'Curacao', CY: 'Cyprus', CZ: 'Czech Republic', CD: 'Democratic Republic of the Congo', DK: 'Denmark', DJ: 'Djibouti', DM: 'Dominica', DO: 'Dominican Republic', TL: 'East Timor', EC: 'Ecuador', EG: 'Egypt', SV: 'El Salvador', GQ: 'Equatorial Guinea', ER: 'Eritrea', EE: 'Estonia', ET: 'Ethiopia', FK: 'Falkland Islands', FO: 'Faroe Islands', FJ: 'Fiji', FI: 'Finland', FR: 'France', PF: 'French Polynesia', GA: 'Gabon', GM: 'Gambia', GE: 'Georgia', DE: 'Germany', GH: 'Ghana', GI: 'Gibraltar', GR: 'Greece', GL: 'Greenland', GD: 'Grenada', GU: 'Guam', GT: 'Guatemala', GG: 'Guernsey', GN: 'Guinea', GW: 'Guinea-Bissau', GY: 'Guyana', HT: 'Haiti', HN: 'Honduras', HK: 'Hong Kong', HU: 'Hungary', IS: 'Iceland', IN: 'India', ID: 'Indonesia', IR: 'Iran', IQ: 'Iraq', IE: 'Ireland', IM: 'Isle of Man', IL: 'Israel', IT: 'Italy', CI: 'Ivory Coast', JM: 'Jamaica', JP: 'Japan', JE: 'Jersey', JO: 'Jordan', KZ: 'Kazakhstan', KE: 'Kenya', KI: 'Kiribati', XK: 'Kosovo', KW: 'Kuwait', KG: 'Kyrgyzstan', LA: 'Laos', LV: 'Latvia', LB: 'Lebanon', LS: 'Lesotho', LR: 'Liberia', LY: 'Libya', LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg', MO: 'Macau', MK: 'Macedonia', MG: 'Madagascar', MW: 'Malawi', MY: 'Malaysia', MV: 'Maldives', ML: 'Mali', MT: 'Malta', MH: 'Marshall Islands', MR: 'Mauritania', MU: 'Mauritius', YT: 'Mayotte', MX: 'Mexico', FM: 'Micronesia', MD: 'Moldova', MC: 'Monaco', MN: 'Mongolia', ME: 'Montenegro', MS: 'Montserrat', MA: 'Morocco', MZ: 'Mozambique', MM: 'Myanmar', NA: 'Namibia', NR: 'Nauru', NP: 'Nepal', NL: 'Netherlands', AN: 'Netherlands Antilles', NC: 'New Caledonia', NZ: 'New Zealand', NI: 'Nicaragua', NE: 'Niger', NG: 'Nigeria', NU: 'Niue', KP: 'North Korea', MP: 'Northern Mariana Islands', NO: 'Norway', OM: 'Oman', PK: 'Pakistan', PW: 'Palau', PS: 'Palestine', PA: 'Panama', PG: 'Papua New Guinea', PY: 'Paraguay', PE: 'Peru', PH: 'Philippines', PN: 'Pitcairn', PL: 'Poland', PT: 'Portugal', PR: 'Puerto Rico', QA: 'Qatar', CG: 'Republic of the Congo', RE: 'Reunion', RO: 'Romania', RU: 'Russia', RW: 'Rwanda', BL: 'Saint Barthelemy', SH: 'Saint Helena', KN: 'Saint Kitts and Nevis', LC: 'Saint Lucia', MF: 'Saint Martin', PM: 'Saint Pierre and Miquelon', VC: 'Saint Vincent and the Grenadines', WS: 'Samoa', SM: 'San Marino', ST: 'Sao Tome and Principe', SA: 'Saudi Arabia', SN: 'Senegal', RS: 'Serbia', SC: 'Seychelles', SL: 'Sierra Leone', SG: 'Singapore', SX: 'Sint Maarten', SK: 'Slovakia', SI: 'Slovenia', SB: 'Solomon Islands', SO: 'Somalia', ZA: 'South Africa', KR: 'South Korea', SS: 'South Sudan', ES: 'Spain', LK: 'Sri Lanka', SD: 'Sudan', SR: 'Suriname', SJ: 'Svalbard and Jan Mayen', SZ: 'Swaziland', SE: 'Sweden', CH: 'Switzerland', SY: 'Syria', TW: 'Taiwan', TJ: 'Tajikistan', TZ: 'Tanzania', TH: 'Thailand', TG: 'Togo', TK: 'Tokelau', TO: 'Tonga', TT: 'Trinidad and Tobago', TN: 'Tunisia', TR: 'Turkey', TM: 'Turkmenistan', TC: 'Turks and Caicos Islands', TV: 'Tuvalu', UG: 'Uganda', UA: 'Ukraine', AE: 'United Arab Emirates', GB: 'United Kingdom', US: 'United States', UY: 'Uruguay', UZ: 'Uzbekistan', VU: 'Vanuatu', VA: 'Vatican', VE: 'Venezuela', VN: 'Vietnam', VI: 'Virgin Islands', YE: 'Yemen', ZM: 'Zambia', ZW: 'Zimbabwe'
};
