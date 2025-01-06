import express from 'express';
import { getNode, createNode, deleteNodeByChatId, handleIncomingMessage, webhookVerification,  createChatFlow,
    getNodesByChatId,
    getNodesByChatName,
    updateNode,
    deleteNode, getPaginatedChatbots} from '../controllers/nodeController';
import { validateRequest } from '../middlewares/errorHandler';
import { nodeValidation } from '../utils/joiSchemas';
import { authorizeRole } from '../middlewares/roleAuthorization';

const router = express.Router();

router.post('/', authorizeRole(['BOTCREATOR','SUPERADMIN']), validateRequest(nodeValidation), createNode);
router.get('/', getNode);
router.get('/webhook', handleIncomingMessage);
router.post('/webhook', webhookVerification);
router.delete('/chatbot/:chat_id', deleteNodeByChatId);
router.post('/chatflow', authorizeRole(['BOTCREATOR', 'SUPERADMIN']), createChatFlow); // Create full flow
router.get('/chatbot/:chatId', getNodesByChatId); // Get nodes by chatId
router.get('/by-chat-name/:chatName', authorizeRole(['BOTCREATOR', 'SUPERADMIN']), getNodesByChatName); // Get nodes by chatName
router.put('/:id', authorizeRole(['BOTCREATOR', 'SUPERADMIN']), updateNode); // Update node
router.delete('/node/:id', authorizeRole(['SUPERADMIN']), deleteNode);
router.get('/chatbots', getPaginatedChatbots);
export default router;
