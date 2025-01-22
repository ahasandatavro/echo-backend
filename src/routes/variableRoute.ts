import express from 'express';
import {
  getVariables,
  createVariable,
  updateVariable,
  deleteVariable,
  getVariablesByChatbotId,
  getVariablesByConversationId,
} from '../controllers/variableController';

const router = express.Router();

router.get('/', getVariables); 
router.post('/', createVariable);
router.put('/:id', updateVariable);
router.delete('/:id', deleteVariable);
router.get('/chatbot/:chatbotId', getVariablesByChatbotId); 
router.get('/conversation/:conversationId', getVariablesByConversationId);

export default router;
