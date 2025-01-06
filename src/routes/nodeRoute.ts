import express from 'express';
import { getNode, createNode, deleteNodeByChatId, handleIncomingMessage, webhookVerification } from '../controllers/nodeController';
import { validateRequest } from '../middlewares/errorHandler';
import { nodeValidation } from '../utils/joiSchemas';
import { authorizeRole } from '../middlewares/roleAuthorization';

const router = express.Router();

router.post('/', authorizeRole(['BOTCREATOR','SUPERADMIN']), validateRequest(nodeValidation), createNode);
router.get('/', getNode);
router.get('/webhook', handleIncomingMessage);
router.post('/webhook', webhookVerification);
router.delete('/:chat_id', authorizeRole(['SUPERADMIN']), deleteNodeByChatId);

export default router;
