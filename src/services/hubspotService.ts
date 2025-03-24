import axios from 'axios';
import UserModel from '../models/userModel';

interface ContactProperties {
  email: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  whatsapp_number?: string;
  [key: string]: any;
}

class HubspotService {
  private apiKey: string | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor() {
    this.loadCredentials();
  }

  // Load API key or OAuth tokens from environment variables or database
  private async loadCredentials() {
    // Load from environment variables first
    this.apiKey = process.env.HUBSPOT_API_KEY || null;
    
    if (!this.apiKey) {
      // Try to load from database (first user for simplicity, replace with proper logic)
      try {
        const user = await UserModel.findOne({ 'integrations.hubspot.isConnected': true });
        if (user && user.integrations && user.integrations.hubspot) {
          this.apiKey = user.integrations.hubspot.apiKey || null;
          this.accessToken = user.integrations.hubspot.accessToken || null;
          this.refreshToken = user.integrations.hubspot.refreshToken || null;
          this.tokenExpiry = user.integrations.hubspot.tokenExpiry || null;
        }
      } catch (error) {
        console.error('Error loading HubSpot credentials from database:', error);
      }
    }
  }

  // Store OAuth tokens
  async storeAccessToken(accessToken: string, refreshToken: string, expiresIn: number) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);
    
    // Store in database
    try {
      // For demonstration, we're storing in the first user
      // In a real app, you'd store this for the currently authenticated user
      await UserModel.findOneAndUpdate(
        { 'integrations.hubspot.isConnected': true },
        {
          'integrations.hubspot.accessToken': accessToken,
          'integrations.hubspot.refreshToken': refreshToken,
          'integrations.hubspot.tokenExpiry': this.tokenExpiry,
          'integrations.hubspot.isConnected': true
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('Error storing HubSpot tokens in database:', error);
      throw error;
    }
  }

  // Update API key
  async updateApiKey(apiKey: string) {
    this.apiKey = apiKey;
    
    // Verify the API key works
    try {
      await this.verifyConnection();
    } catch (error) {
      this.apiKey = null; // Reset if invalid
      throw new Error('Invalid HubSpot API key');
    }
  }

  // Refresh OAuth token if expired
  private async refreshAccessTokenIfNeeded() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }
    
    if (!this.tokenExpiry || new Date() >= this.tokenExpiry) {
      try {
        const clientId = process.env.HUBSPOT_CLIENT_ID;
        const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
        
        const response = await axios.post('https://api.hubapi.com/oauth/v1/token', null, {
          params: {
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: this.refreshToken
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
        
        const { access_token, refresh_token, expires_in } = response.data;
        
        // Update tokens
        await this.storeAccessToken(access_token, refresh_token, expires_in);
      } catch (error) {
        console.error('Error refreshing HubSpot token:', error);
        throw new Error('Failed to refresh HubSpot access token');
      }
    }
  }

  // Get authorization header based on available credentials
  private async getAuthHeader() {
    if (this.accessToken) {
      // Use OAuth if available
      await this.refreshAccessTokenIfNeeded();
      return { Authorization: `Bearer ${this.accessToken}` };
    } else if (this.apiKey) {
      // Fall back to API key
      return { 'X-HubSpot-API-Key': this.apiKey };
    } else {
      throw new Error('No valid HubSpot credentials available');
    }
  }

  // Verify connection to HubSpot
  async verifyConnection() {
    try {
      const headers = await this.getAuthHeader();
      await axios.get('https://api.hubapi.com/crm/v3/objects/contacts', {
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        params: {
          limit: 1
        }
      });
      
      return true;
    } catch (error) {
      console.error('HubSpot connection verification failed:', error);
      throw new Error('Failed to verify connection to HubSpot');
    }
  }

  // Create or update a contact
  async createOrUpdateContact(contactData: ContactProperties) {
    try {
      const headers = await this.getAuthHeader();
      
      // First check if contact exists
      const existingContact = await this.getContactByEmail(contactData.email).catch(() => null);
      
      if (existingContact) {
        // Update existing contact
        const properties: Record<string, string> = {};
        
        Object.keys(contactData).forEach(key => {
          if (contactData[key] !== undefined) {
            properties[key] = contactData[key].toString();
          }
        });
        
        const response = await axios.patch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${existingContact.id}`,
          {
            properties
          },
          {
            headers: {
              ...headers,
              'Content-Type': 'application/json'
            }
          }
        );
        
        return response.data;
      } else {
        // Create new contact
        const properties: Record<string, string> = {};
        
        Object.keys(contactData).forEach(key => {
          if (contactData[key] !== undefined) {
            properties[key] = contactData[key].toString();
          }
        });
        
        const response = await axios.post(
          'https://api.hubapi.com/crm/v3/objects/contacts',
          {
            properties
          },
          {
            headers: {
              ...headers,
              'Content-Type': 'application/json'
            }
          }
        );
        
        return response.data;
      }
    } catch (error) {
      console.error('Error creating/updating HubSpot contact:', error);
      throw error;
    }
  }

  // Get contact by email
  async getContactByEmail(email: string) {
    try {
      const headers = await this.getAuthHeader();
      
      const response = await axios.get('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        data: {
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
        }
      });
      
      if (response.data.results && response.data.results.length > 0) {
        return response.data.results[0];
      }
      
      return null;
    } catch (error) {
      console.error('Error getting HubSpot contact by email:', error);
      throw error;
    }
  }

  // Send WhatsApp message via HubSpot
  async sendWhatsAppMessage(contactId: string, templateName: string, parameters: any[] = []) {
    try {
      const headers = await this.getAuthHeader();
      
      // This is a custom endpoint example - you would need to implement this
      // based on HubSpot's specific WhatsApp integration capabilities
      const response = await axios.post(
        `https://api.hubapi.com/crm/v3/extensions/messaging/whatsapp/send`,
        {
          contactId,
          templateName,
          parameters
        },
        {
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return response.data;
    } catch (error) {
      console.error('Error sending WhatsApp message via HubSpot:', error);
      throw error;
    }
  }
}

export default new HubspotService();