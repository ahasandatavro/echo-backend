import express from 'express';
import { getNode, createNode, deleteNodeByChatId, createChatFlow,
    getNodesByChatId,
    getNodesByChatName,
    updateNode,
    deleteNode, getPaginatedChatbots, updateChatFlow} from '../controllers/nodeController';
import { validateRequest } from '../middlewares/errorHandler';
import { nodeValidation } from '../utils/joiSchemas';
import { authorizeRole } from '../middlewares/roleAuthorization';

const router = express.Router();

router.post('/', authorizeRole(['BOTCREATOR','SUPERADMIN']), validateRequest(nodeValidation), createNode);
router.get('/', getNode);
router.put('/:id', authorizeRole(['BOTCREATOR', 'SUPERADMIN']), updateNode); // Update node
router.delete('/node/:id', authorizeRole(['SUPERADMIN']), deleteNode);


router.get('/chatbots', getPaginatedChatbots);
router.put('/chatflow/:chatId', updateChatFlow); // Update chat flow
router.delete('/chatbot/:chat_id', deleteNodeByChatId);
router.post('/chatflow', createChatFlow); // Create full flow
router.get('/chatbot/:chatId', getNodesByChatId); // Get nodes by chatId
router.get('/by-chat-name/:chatName', authorizeRole(['BOTCREATOR', 'SUPERADMIN']), getNodesByChatName); 


export default router;
