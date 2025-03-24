const { Client } = require('@hubspot/api-client');
require('dotenv').config();

interface HubspotProperties {
  [key: string]: string | number | boolean;
}

interface WhatsAppParameter {
  value: string;
}

class HubspotService {
  private client: any;

  constructor() {
    this.client = null;
  }

  initialize(apiKey: string): any {
    this.client = new Client({ apiKey });
    return this.client;
  }

  getClient(): any {
    if (!this.client) {
      const apiKey = process.env.HUBSPOT_API_KEY;
      if (!apiKey) {
        throw new Error('HUBSPOT_API_KEY is not defined in environment variables');
      }
      this.initialize(apiKey);
    }
    return this.client;
  }

  async createOrUpdateContact(properties: HubspotProperties): Promise<any> {
    try {
      const hubspotClient = this.getClient();
      
      // Convert properties from flat object to HubSpot format
      const hubspotProperties: HubspotProperties = {};
      Object.keys(properties).forEach(key => {
        if (properties[key]) {
          hubspotProperties[key] = properties[key];
        }
      });
      
      // Create or update contact
      const response = await hubspotClient.crm.contacts.basicApi.create({ properties: hubspotProperties });
      return response;
    } catch (error) {
      console.error('Error creating/updating HubSpot contact:', error);
      throw error;
    }
  }

  async getContactByEmail(email: string): Promise<any> {
    try {
      const hubspotClient = this.getClient();
      
      // Search for contact by email
      const publicObjectSearchRequest = {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'email',
                operator: 'EQ',
                value: email,
              },
            ],
          },
        ],
        properties: ['email', 'firstname', 'lastname', 'phone', 'company'],
        limit: 1,
      };
      
      const searchResponse = await hubspotClient.crm.contacts.searchApi.doSearch(publicObjectSearchRequest);
      return searchResponse.results[0] || null;
    } catch (error) {
      console.error('Error fetching HubSpot contact:', error);
      throw error;
    }
  }

  async sendWhatsAppMessage(contactId: string, templateName: string, parameters: WhatsAppParameter[]): Promise<any> {
    try {
      const hubspotClient = this.getClient();
      
      // This is an example - you'll need to use appropriate HubSpot API endpoints
      // for sending WhatsApp messages through their channels or workflows
      const payload = {
        recipient: {
          id: contactId
        },
        message_template: {
          name: templateName,
          language: {
            code: 'en'
          },
          components: parameters.map(param => ({
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: param.value
              }
            ]
          }))
        }
      };
      
      // You might need to call a custom integration or workflow endpoint
      // This is just an example structure - adapt to the actual HubSpot API needed
      const response = await hubspotClient.apiRequest({
        method: 'POST',
        path: '/crm/v3/extensions/calling/request',
        body: payload
      });
      
      return response;
    } catch (error) {
      console.error('Error sending WhatsApp message via HubSpot:', error);
      throw error;
    }
  }

  async verifyConnection(): Promise<any> {
    try {
      const hubspotClient = this.getClient();
      // Make a simple API call to verify connection
      const response = await hubspotClient.apiRequest({
        method: 'GET',
        path: '/crm/v3/properties/contact'
      });
      return { success: true, data: response };
    } catch (error) {
      console.error('Error verifying HubSpot connection:', error);
      throw error;
    }
  }

  async updateApiKey(apiKey: string): Promise<any> {
    // Re-initialize the client with the new API key
    this.initialize(apiKey);
    return this.verifyConnection();
  }
}

module.exports = new HubspotService();