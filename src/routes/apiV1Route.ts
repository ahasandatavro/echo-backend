import express from "express";
import * as apiV1Controller from '../controllers/apiV1Controller'
import multer from "multer";
import { validateRequest, validateQueryParams, validatePathParams } from '../middlewares/errorHandler';
import {
  chatbotStartValidation,
  sendSessionMessageValidation,
  sendTemplateMessageValidation,
  sendTemplateMessagesValidation,
  sendInteractiveButtonMessageValidation,
  sendInteractiveListMessageValidation,
  assignOperatorValidation,
  assignTeamValidation,
  phoneNumberIdValidation,
  whatsappNumberPathValidation,
  whatsappNumberQueryValidation,
  getContactsQueryValidation,
  getChatbotsQueryValidation,
  getMediaQueryValidation,
  getMessagesQueryValidation,
  getMessageTemplatesQueryValidation,
  addContactValidation
} from '../utils/joiSchemas';

const router = express.Router();

const storage = multer.memoryStorage(); // ⬅️ Enables buffer access
const upload = multer({ storage });

// -------------------- WhatsApp API --------------------
router.get("/:phoneNumberId/getMessages/:whatsappNumber", 
  validatePathParams(phoneNumberIdValidation),
  validatePathParams(whatsappNumberPathValidation),
  validateQueryParams(getMessagesQueryValidation),
  apiV1Controller.getMessages
);
router.get("/:phoneNumberId/getMessageTemplates", 
  validatePathParams(phoneNumberIdValidation),
  validateQueryParams(getMessageTemplatesQueryValidation),
  apiV1Controller.getMessageTemplates
);
router.get("/:phoneNumberId/getContacts", 
  validatePathParams(phoneNumberIdValidation),
  validateQueryParams(getContactsQueryValidation),
  apiV1Controller.getContacts
);
router.get("/:phoneNumberId/getMedia", 
  validatePathParams(phoneNumberIdValidation),
  validateQueryParams(getMediaQueryValidation),
  apiV1Controller.getMedia
);

router.post("/:phoneNumberId/updateContactAttributes/:whatsappNumber", apiV1Controller.updateContactAttributes);
router.post("/:phoneNumberId/updateContactAttributesForMultiContacts", apiV1Controller.updateContactAttributesForMultiContacts);
router.post("/:phoneNumberId/api/v1/rotateToken", apiV1Controller.rotateToken);
router.post("/:phoneNumberId/addContact/:whatsappNumber", 
  validatePathParams(phoneNumberIdValidation),
  validatePathParams(whatsappNumberPathValidation),
  validateRequest(addContactValidation),
  apiV1Controller.addContact
);
router.post("/:phoneNumberId/sendSessionFile/:whatsappNumber", 
  validatePathParams(phoneNumberIdValidation),
  validatePathParams(whatsappNumberPathValidation),
  upload.single("file"), 
  apiV1Controller.sendSessionFile
);
router.post("/:phoneNumberId/sendSessionMessage/:whatsappNumber", 
  validatePathParams(phoneNumberIdValidation),
  validatePathParams(whatsappNumberPathValidation),
  validateQueryParams(sendSessionMessageValidation),
  apiV1Controller.sendSessionMessage
);
router.post("/:phoneNumberId/sendTemplateMessage", 
  validatePathParams(phoneNumberIdValidation),
  validateQueryParams(whatsappNumberQueryValidation),
  validateRequest(sendTemplateMessageValidation),
  apiV1Controller.sendTemplateMessage
);
router.post("/:phoneNumberId/sendTemplateMessages", 
  validatePathParams(phoneNumberIdValidation),
  validateRequest(sendTemplateMessagesValidation),
  apiV1Controller.sendTemplateMessages
);
router.post("/:phoneNumberId/sendTemplateMessagesCSV", 
  validatePathParams(phoneNumberIdValidation),
  apiV1Controller.sendTemplateMessagesCSV
);
router.post("/:phoneNumberId/sendInteractiveButtonsMessage", 
  validatePathParams(phoneNumberIdValidation),
  validateQueryParams(whatsappNumberQueryValidation),
  validateRequest(sendInteractiveButtonMessageValidation),
  apiV1Controller.sendInteractiveButtonsMessage
);
router.post("/:phoneNumberId/sendInteractiveListMessage", 
  validatePathParams(phoneNumberIdValidation),
  validateQueryParams(whatsappNumberQueryValidation),
  validateRequest(sendInteractiveListMessageValidation),
  apiV1Controller.sendInteractiveListMessage
);
router.post("/:phoneNumberId/assignOperator", 
  validatePathParams(phoneNumberIdValidation),
  validateQueryParams(assignOperatorValidation),
  apiV1Controller.assignOperator
);
router.post("/:phoneNumberId/assignTeam", 
  validatePathParams(phoneNumberIdValidation),
  validateQueryParams(assignTeamValidation),
  apiV1Controller.assignTeam
);
router.post("/:phoneNumberId/updateChatStatus", apiV1Controller.updateChatStatus);

router.get("/:phoneNumberId/chatbots", 
  validatePathParams(phoneNumberIdValidation),
  validateQueryParams(getChatbotsQueryValidation),
  apiV1Controller.getChatbots
);
router.post("/:phoneNumberId/chatbots/start", 
  validatePathParams(phoneNumberIdValidation),
  validateQueryParams(chatbotStartValidation),
  apiV1Controller.startChatbot
);
router.post("/:phoneNumberId/chatbots/update", apiV1Controller.updateChatbot);
router.post("/:phoneNumberId/chatbots/stop", apiV1Controller.stopChatbot);

// -------------------- WhatsApp Payment API --------------------
router.post("/:phoneNumberId/order_details", apiV1Controller.orderDetails);
router.post("/:phoneNumberId/order_details_template", apiV1Controller.orderDetailsTemplate);
router.post("/:phoneNumberId/order_status", apiV1Controller.orderStatus);
router.post("/:phoneNumberId/order_status_template", apiV1Controller.orderStatusTemplate);
router.post("/:phoneNumberId/checkout_button_template", apiV1Controller.checkoutButtonTemplate);
router.get("/:phoneNumberId/order_details/:referenceId", apiV1Controller.getOrderDetailsByReferenceId);
router.get("/:phoneNumberId/payment_status/:referenceId", apiV1Controller.getPaymentStatusByReferenceId);

export default router; 