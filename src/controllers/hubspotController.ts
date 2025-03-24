import { Request, Response } from 'express';
const hubspotService = require('../services/hubspotService');
const UserModel = require('../models/userModel'); // Adjust to your actual user model

class HubspotController {
  async verifyConnection(req: Request, res: Response) {
    try {
      await hubspotService.verifyConnection();
      res.status(200).json({ success: true, message: 'HubSpot connection verified' });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to verify HubSpot connection', 
        error: error.message 
      });
    }
  }

  async updateApiKey(req: Request, res: Response) {
    try {
      const { apiKey } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({ success: false, message: 'API key is required' });
      }
      
      // Update API key in the service
      await hubspotService.updateApiKey(apiKey);
      
      // Store API key in user settings
      if (req.user && req.user.id) {
        await UserModel.findByIdAndUpdate(req.user.id, {
          'integrations.hubspot.apiKey': apiKey,
          'integrations.hubspot.isConnected': true
        });
      }
      
      res.status(200).json({ success: true, message: 'HubSpot API key updated successfully' });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to update HubSpot API key', 
        error: error.message 
      });
    }
  }

  async createContact(req: Request, res: Response) {
    try {
      const contactData = req.body;
      
      if (!contactData.email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
      }
      
      const response = await hubspotService.createOrUpdateContact(contactData);
      
      res.status(201).json({ 
        success: true, 
        message: 'Contact created/updated in HubSpot', 
        contactId: response.id 
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to create/update contact in HubSpot', 
        error: error.message 
      });
    }
  }

  async getContactByEmail(req: Request, res: Response) {
    try {
      const { email } = req.params;
      
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
      }
      
      const contact = await hubspotService.getContactByEmail(email);
      
      if (!contact) {
        return res.status(404).json({ success: false, message: 'Contact not found' });
      }
      
      res.status(200).json({ success: true, contact });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch contact from HubSpot', 
        error: error.message 
      });
    }
  }

  async sendWhatsAppMessage(req: Request, res: Response) {
    try {
      const { contactId, templateName, parameters } = req.body;
      
      if (!contactId || !templateName) {
        return res.status(400).json({ 
          success: false, 
          message: 'Contact ID and template name are required' 
        });
      }
      
      const response = await hubspotService.sendWhatsAppMessage(contactId, templateName, parameters || []);
      
      res.status(200).json({ 
        success: true, 
        message: 'WhatsApp message sent via HubSpot', 
        data: response 
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send WhatsApp message via HubSpot', 
        error: error.message 
      });
    }
  }
  
  async getIntegrationStatus(req: Request, res: Response) {
    try {
      // Check if the user has HubSpot integration configured
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
      }
      
      const user = await UserModel.findById(req.user.id);
      
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      
      const hasHubspotIntegration = user.integrations && 
                                   user.integrations.hubspot && 
                                   user.integrations.hubspot.isConnected;
      
      res.status(200).json({ 
        success: true, 
        isConnected: !!hasHubspotIntegration 
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch integration status', 
        error: error.message 
      });
    }
  }
}

export default new HubspotController(); 