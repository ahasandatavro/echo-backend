import { Request, Response } from 'express';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

// Function to get HubSpot access configuration from environment variables
const getHubSpotAccessConfig = () => {
  try {
    const config = process.env.HUBSPOT_ACCESS_CONFIG;
    if (!config) {
      throw new Error('HUBSPOT_ACCESS_CONFIG not found in environment variables');
    }
    return JSON.parse(config);
  } catch (error) {
    console.error('Error parsing HUBSPOT_ACCESS_CONFIG:', error);
    // Return default access configuration if parsing fails
    return { "Free": false, "Growth": true, "Pro": true, "Business": true };
  }
};

// Function to check HubSpot access based on user package
const checkHubSpotAccess = (packageName: string) => {
  if (!packageName) {
    return {
      hasAccess: false,
      error: "No active subscription found. Please upgrade your plan to access HubSpot integration."
    };
  }

  const accessConfig = getHubSpotAccessConfig();
  const hasAccess = accessConfig[packageName];

  if (hasAccess === undefined) {
    return {
      hasAccess: false,
      error: `Unknown package: ${packageName}. Please contact support for assistance.`,
      currentPackage: packageName
    };
  }

  if (!hasAccess) {
    // Get packages that have access for upgrade suggestions
    const availablePackages = Object.entries(accessConfig)
      .filter(([_, hasAccess]) => hasAccess)
      .map(([packageName, _]) => packageName);

    return {
      hasAccess: false,
      error: `${packageName} plan does not include HubSpot integration. Please upgrade to ${availablePackages.join(', ')} plan to access this feature.`,
      currentPackage: packageName,
      requiredPackages: availablePackages
    };
  }

  return {
    hasAccess: true,
    package: packageName
  };
};

// Helper functions
const getUserWithHubspotIntegration = async () => {
  const integration = await prisma.hubspotIntegration.findFirst({
    where: {
      isActive: true,
      accessToken: { not: null }
    },
    include: {
      user: true
    }
  });
  
  return integration ? {
    id: integration.userId,
    accessToken: integration.accessToken,
    refreshToken: integration.refreshToken,
    accessTokenExpiresAt: integration.tokenExpiresAt,
  } : null;
};

const refreshHubspotToken = async (userId: number, refreshToken: string | null) => {
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }
  
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('HubSpot client credentials not configured');
  }
  
  const response = await axios.post('https://api.hubapi.com/oauth/v1/token', null, {
    params: {
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  
  const { access_token, refresh_token, expires_in } = response.data;
  
  // Update in dedicated integration model
  await prisma.hubspotIntegration.updateMany({
    where: { userId },
    data: {
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiresAt: Math.floor(Date.now() / 1000) + expires_in
    }
  });
};

const getContactByEmailHelper = async (email: string, accessToken: string) => {
  try {
    const response = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/contacts/search',
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'email',
                operator: 'EQ',
                value: email
              }
            ]
          }
        ],
        properties: [
          'email',
          'firstname',
          'lastname',
          'phone',
          'whatsapp_number'
        ],
        limit: 1
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.data.results && response.data.results.length > 0) {
      return response.data.results[0];
    }
    
    return null;
  } catch (error) {
    console.error('Error getting HubSpot contact by email:', error);
    throw error;
  }
};

// Controller functions
export const initiateOAuth = async (req: Request, res: Response) => {
  try {
    let userId;
    if (req.user) {
      const reqUser = req.user as any;
      userId = reqUser.userId;
    }

    // Get user information and check package access
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
    });

    if (!dbUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Check user's package subscription
    const userPackage = user.activeSubscription?.packageName;
    
    // Check HubSpot access based on package
    const accessCheck = checkHubSpotAccess(userPackage);
    if (!accessCheck.hasAccess) {
      return res.status(403).json({
        success: false,
        message: accessCheck.error,
        currentPackage: accessCheck.currentPackage,
        requiredPackages: accessCheck.requiredPackages
      });
    }

    const clientId = process.env.HUBSPOT_CLIENT_ID;
    if (!clientId) {
      console.error('HUBSPOT_CLIENT_ID is not defined in environment variables');
      return res.status(500).json({ 
        success: false, 
        message: 'HubSpot client ID is not configured',
      });
    }
    
    const redirectUri = `${process.env.APP_URL || 'http://localhost:5000'}/hubspot/oauth/callback`;
    const scopes = "content crm.objects.contacts.read crm.objects.contacts.write";
    const state = encodeURIComponent(JSON.stringify({ userId: userId }));
    const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}`;
    
    //console.log('Redirect URL:', authUrl);
    
    // Redirect directly to HubSpot OAuth page
    res.json({ redirectUrl: authUrl });

  } catch (error: unknown) {
    console.error('Error initiating HubSpot OAuth:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to initiate HubSpot OAuth flow', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const handleOAuthCallback = async (req: Request, res: Response) => {
  try {
    //console.log('Handling OAuth callback, query params:', req.query);
    
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).json({ success: false, message: 'Authorization code is missing' });
    }
    const parsedState = JSON.parse(decodeURIComponent(state as string));
    const userIdFromState = parsedState.userId;
    // Exchange the authorization code for an access token
    const clientId = process.env.HUBSPOT_CLIENT_ID;
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error('HubSpot credentials not configured');
      return res.status(500).json({ 
        success: false, 
        message: 'HubSpot credentials are not properly configured'
      });
    }
    
    const redirectUri = `${process.env.APP_URL || 'http://localhost:5000'}/hubspot/oauth/callback`;
    
    console.log('Exchanging code for token...');
    
    const response = await axios.post('https://api.hubapi.com/oauth/v1/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code: code as string
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    console.log('Token exchange successful');
    
    const { access_token, refresh_token, expires_in } = response.data;
    
    // Store the tokens in the database
    try {
    
      if (userIdFromState) {
        // Check if integration record exists
        const existingIntegration = await prisma.hubspotIntegration.findUnique({
          where: { userId: userIdFromState }
        });
        
        if (existingIntegration) {
          // Update existing record
          await prisma.hubspotIntegration.update({
            where: { id: existingIntegration.id },
            data: {
              accessToken: access_token,
              refreshToken: refresh_token,
              tokenExpiresAt: Math.floor(Date.now() / 1000) + expires_in,
              isActive: true
            }
          });
        } else {
          // Create new record
          await prisma.hubspotIntegration.create({
            data: {
              userId: userIdFromState,
              accessToken: access_token,
              refreshToken: refresh_token,
              tokenExpiresAt: Math.floor(Date.now() / 1000) + expires_in,
              isActive: true
            }
          });
        }
        
        //console.log('OAuth tokens stored for user ID:', userId);
      }
    } catch (dbError) {
      console.error('Error storing HubSpot tokens in database:', dbError);
      // Continue despite database error
    }
    
    // Redirect back to your app
    //res.redirect('/crm/integrations?hubspot=success');
    res.redirect(`${process.env.FRONTEND_URL}/#/teamInbox`);

  } catch (error: unknown) {
    console.error('Error handling HubSpot OAuth callback:', error);
    res.redirect('/crm/integrations?hubspot=error&message=' + encodeURIComponent(
      error instanceof Error ? error.message : String(error)
    ));
  }
};

export const verifyConnection = async (req: Request, res: Response) => {
  try {
    // Get the user's HubSpot credentials
    const user = await getUserWithHubspotIntegration();
    
    if (!user || !user.accessToken) {
      return res.status(401).json({ 
        success: false, 
        message: 'HubSpot integration not configured'
      });
    }
    
    // Check token expiry
    if (user.accessTokenExpiresAt && user.accessTokenExpiresAt < Math.floor(Date.now() / 1000)) {
      // Token expired, attempt to refresh
      try {
        await refreshHubspotToken(user.id, user.refreshToken);
      } catch (refreshError) {
        return res.status(401).json({ 
          success: false, 
          message: 'HubSpot access token expired and could not be refreshed' 
        });
      }
    }
    
    // Get the latest user data with the refreshed token
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id }
    });
    
    if (!updatedUser || !updatedUser.accessToken) {
      return res.status(401).json({ 
        success: false, 
        message: 'Failed to retrieve HubSpot credentials' 
      });
    }
    
    // Verify connection with HubSpot API
    await axios.get('https://api.hubapi.com/crm/v3/objects/contacts', {
      headers: {
        Authorization: `Bearer ${updatedUser.accessToken}`,
        'Content-Type': 'application/json'
      },
      params: {
        limit: 1 // We just need to verify connection, not retrieve data
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'HubSpot connection verified',
      connected: true
    });
  } catch (error: unknown) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to verify HubSpot connection', 
      error: error instanceof Error ? error.message : String(error),
      connected: false
    });
  }
};

export const updateApiKey = async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body as { apiKey?: string };
    
    if (!apiKey) {
      return res.status(400).json({ success: false, message: 'API key is required' });
    }
    
    // Verify the API key works with HubSpot
    try {
      await axios.get('https://api.hubapi.com/crm/v3/objects/contacts', {
        headers: {
          'X-HubSpot-API-Key': apiKey,
          'Content-Type': 'application/json'
        },
        params: {
          limit: 1
        }
      });
    } catch (apiError) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid HubSpot API key' 
      });
    }
    
    // Store API key in HubspotIntegration model
    if (req.user) {
      const reqUser = req.user as any;
      const userId = reqUser.userId;
      
      // Check if integration record exists
      const existingIntegration = await prisma.hubspotIntegration.findUnique({
        where: { userId }
      });
      
      if (existingIntegration) {
        await prisma.hubspotIntegration.update({
          where: { id: existingIntegration.id },
          data: {
            accessToken: apiKey,
            refreshToken: null,
            tokenExpiresAt: null,
            isActive: true
          }
        });
      } else {
        await prisma.hubspotIntegration.create({
          data: {
            userId,
            accessToken: apiKey,
            refreshToken: null,
            tokenExpiresAt: null,
            isActive: true
          }
        });
      }
    } else {
      // If no authenticated user, find an admin to store the key for
      const adminUser = await prisma.user.findFirst({
        where: { role: 'SUPERADMIN' }
      });
      
      if (adminUser) {
        // Check for existing integration
        const existingIntegration = await prisma.hubspotIntegration.findUnique({
          where: { userId: adminUser.id }
        });
        
        if (existingIntegration) {
          await prisma.hubspotIntegration.update({
            where: { id: existingIntegration.id },
            data: {
              accessToken: apiKey,
              refreshToken: null,
              tokenExpiresAt: null,
              isActive: true
            }
          });
        } else {
          await prisma.hubspotIntegration.create({
            data: {
              userId: adminUser.id,
              accessToken: apiKey,
              refreshToken: null,
              tokenExpiresAt: null,
              isActive: true
            }
          });
        }
      } else {
        return res.status(400).json({ 
          success: false, 
          message: 'No user available to store the API key' 
        });
      }
    }
    
    res.status(200).json({ success: true, message: 'HubSpot API key updated successfully' });
  } catch (error: unknown) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update HubSpot API key', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const createContact = async (req: Request, res: Response) => {
  try {
    const contactData = req.body;
    
    if (!contactData.email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Check user's package subscription for HubSpot access
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
    });

    if (!dbUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Check user's package subscription
    const userPackage = user.activeSubscription?.packageName;
    
    // Check HubSpot access based on package
    const accessCheck = checkHubSpotAccess(userPackage);
    if (!accessCheck.hasAccess) {
      return res.status(403).json({
        success: false,
        message: accessCheck.error,
        currentPackage: accessCheck.currentPackage,
        requiredPackages: accessCheck.requiredPackages
      });
    }
    
    const hubspotUser = await getUserWithHubspotIntegration();
    
    if (!hubspotUser || !hubspotUser.accessToken) {
      return res.status(401).json({ 
        success: false, 
        message: 'HubSpot integration not configured'
      });
    }
    
    // Check if we need to refresh the token
    if (hubspotUser.accessTokenExpiresAt && hubspotUser.accessTokenExpiresAt < Math.floor(Date.now() / 1000)) {
      try {
        await refreshHubspotToken(hubspotUser.id, hubspotUser.refreshToken);
        // Get the user with the refreshed token
        const refreshedUser = await prisma.user.findUnique({
          where: { id: hubspotUser.id }
        });
        if (refreshedUser) {
          hubspotUser.accessToken = refreshedUser.accessToken;
        }
      } catch (refreshError) {
        return res.status(401).json({ 
          success: false, 
          message: 'HubSpot access token expired and could not be refreshed' 
        });
      }
    }
    
    // Check if contact exists
    const existingContact = await getContactByEmailHelper(contactData.email, hubspotUser?.accessToken||"");
    
    let response;
    const properties: Record<string, string> = {};
    
    Object.keys(contactData).forEach(key => {
      if (contactData[key] !== undefined) {
        properties[key] = String(contactData[key]);
      }
    });
    
    if (existingContact) {
      // Update existing contact
      response = await axios.patch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${existingContact.id}`,
        { properties },
        {
          headers: {
            Authorization: `Bearer ${hubspotUser.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } else {
      // Create new contact
      response = await axios.post(
        'https://api.hubapi.com/crm/v3/objects/contacts',
        { properties },
        {
          headers: {
            Authorization: `Bearer ${hubspotUser.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    }
    
    res.status(201).json({ 
      success: true, 
      message: 'Contact created/updated in HubSpot', 
      contactId: response.data.id 
    });
  } catch (error: any) {
    console.log(error.response.data.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create/update contact in HubSpot', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const getContactByEmail = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Check user's package subscription for HubSpot access
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
    });

    if (!dbUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Check user's package subscription
    const userPackage = user.activeSubscription?.packageName;
    
    // Check HubSpot access based on package
    const accessCheck = checkHubSpotAccess(userPackage);
    if (!accessCheck.hasAccess) {
      return res.status(403).json({
        success: false,
        message: accessCheck.error,
        currentPackage: accessCheck.currentPackage,
        requiredPackages: accessCheck.requiredPackages
      });
    }
    
    const hubspotUser = await getUserWithHubspotIntegration();
    
    if (!hubspotUser || !hubspotUser.accessToken) {
      return res.status(401).json({ 
        success: false, 
        message: 'HubSpot integration not configured'
      });
    }
    
    // Check if we need to refresh the token
    if (hubspotUser.accessTokenExpiresAt && hubspotUser.accessTokenExpiresAt < Math.floor(Date.now() / 1000)) {
      try {
        await refreshHubspotToken(hubspotUser.id, hubspotUser.refreshToken);
        // Get the user with the refreshed token
        const refreshedUser = await prisma.user.findUnique({
          where: { id: hubspotUser.id }
        });
        if (refreshedUser) {
          hubspotUser.accessToken = refreshedUser.accessToken;
        }
      } catch (refreshError) {
        return res.status(401).json({ 
          success: false, 
          message: 'HubSpot access token expired and could not be refreshed' 
        });
      }
    }
    
    const contact = await getContactByEmailHelper(email, hubspotUser?.accessToken||"");
    
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact not found' });
    }
    
    res.status(200).json({ success: true, contact });
  } catch (error: unknown) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch contact from HubSpot', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const sendWhatsAppMessage = async (req: Request, res: Response) => {
  try {
    const { contactId, templateName, parameters } = req.body;
    
    if (!contactId || !templateName) {
      return res.status(400).json({ 
        success: false, 
        message: 'Contact ID and template name are required' 
      });
    }
    
    const user = await getUserWithHubspotIntegration();
    
    if (!user || !user.accessToken) {
      return res.status(401).json({ 
        success: false, 
        message: 'HubSpot integration not configured'
      });
    }
    
    // Check if we need to refresh the token
    if (user.accessTokenExpiresAt && user.accessTokenExpiresAt < Math.floor(Date.now() / 1000)) {
      try {
        await refreshHubspotToken(user.id, user.refreshToken);
        // Get the user with the refreshed token
        const refreshedUser = await prisma.user.findUnique({
          where: { id: user.id }
        });
        if (refreshedUser) {
          user.accessToken = refreshedUser.accessToken;
        }
      } catch (refreshError) {
        return res.status(401).json({ 
          success: false, 
          message: 'HubSpot access token expired and could not be refreshed' 
        });
      }
    }
    
    // This endpoint will need to be adjusted based on how HubSpot actually integrates with WhatsApp
    // This is a placeholder implementation
    const response = await axios.post(
      `https://api.hubapi.com/crm/v3/extensions/messaging/whatsapp/send`,
      {
        contactId,
        templateName,
        parameters: parameters || []
      },
      {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.status(200).json({ 
      success: true, 
      message: 'WhatsApp message sent via HubSpot', 
      data: response.data 
    });
  } catch (error: unknown) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send WhatsApp message via HubSpot', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const getIntegrationStatus = async (req: Request, res: Response) => {
  try {
    // Check if there's a valid HubSpot connection
    const user = await getUserWithHubspotIntegration();
    
    if (!user || !user.accessToken) {
      return res.status(200).json({ 
        success: true, 
        isConnected: false
      });
    }
    
    // Check if the token is valid by making a test request
    try {
      if (user.accessTokenExpiresAt && user.accessTokenExpiresAt < Math.floor(Date.now() / 1000)) {
        // Token expired, attempt to refresh
        await refreshHubspotToken(user.id, user.refreshToken);
      }
      
      // Get the latest user data with the refreshed token
      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id }
      });
      
      if (!updatedUser || !updatedUser.accessToken) {
        return res.status(200).json({ 
          success: true, 
          isConnected: false
        });
      }
      
      await axios.get('https://api.hubapi.com/crm/v3/objects/contacts', {
        headers: {
          Authorization: `Bearer ${updatedUser.accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          limit: 1
        }
      });
      
      return res.status(200).json({ 
        success: true, 
        isConnected: true
      });
    } catch (testError) {
      return res.status(200).json({ 
        success: true, 
        isConnected: false
      });
    }
  } catch (error: unknown) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch integration status', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
}; 

// Add this to your existing controller file

export const getConnectedAccounts = async (req: Request, res: Response) => {
  try {
    // Get the authenticated user's ID
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not authenticated' 
      });
    }
    const reqUser = req.user as any;
    const userId = reqUser.userId;

    // Get the specific user's HubSpot integration
    const integration = await prisma.hubspotIntegration.findFirst({
      where: {
        userId: userId,
        isActive: true,
        accessToken: { not: null }
      }
    });

    if (!integration || !integration.accessToken) {
      return res.status(200).json([]);
    }

    // Check if token needs refresh
    if (integration.tokenExpiresAt && integration.tokenExpiresAt < Math.floor(Date.now() / 1000)) {
      try {
        await refreshHubspotToken(integration.userId, integration.refreshToken);
        // Get the updated integration
        const updatedIntegration = await prisma.hubspotIntegration.findUnique({
          where: { id: integration.id }
        });
        if (updatedIntegration) {
          integration.accessToken = updatedIntegration.accessToken;
        }
      } catch (refreshError) {
        console.error('Failed to refresh token:', refreshError);
        return res.status(200).json([]);
      }
    }

    try {
      // Get account information from HubSpot
      const response = await axios.get(`https://api.hubapi.com/oauth/v1/access-tokens/${integration.accessToken}`, {
        headers: {
          Authorization: `Bearer ${integration.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const accountInfo = response.data;
      
      // Return the connected account information
      return res.status(200).json([
        {
          accountDomain: accountInfo.hub_domain,
          userName: accountInfo.user,
          status: 'Connected',
          userId: userId,
          ownerId: accountInfo.user_id
        }
      ]);

    } catch (hubspotError) {
      console.error('Failed to fetch HubSpot account details:', hubspotError);
      // If we can't get account details, return empty array
      return res.status(200).json([]);
    }

  } catch (error: unknown) {
    console.error('Error fetching connected accounts:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch connected accounts', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
};