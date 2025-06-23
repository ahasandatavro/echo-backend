// routes/webhookRoutes.js
import express from 'express';
import {   
    createWebhook,
    getWebhooks,
    getWebhookById,
    updateWebhook,
    deleteWebhook, } from '../controllers/webhookController';
import { authenticateJWT } from '../middlewares/authMiddleware';

const router = express.Router();

// Route to create a new webhook
router.post('/', createWebhook);

router.get('/',  getWebhooks);

// Get a specific webhook by ID
router.get('/:id', getWebhookById);

// Update a webhook
router.put('/:id',  updateWebhook);

// Delete a webhook
router.delete('/:id',  deleteWebhook);

export default router;