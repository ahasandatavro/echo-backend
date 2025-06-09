import express from "express";
import * as apiV1Controller from '../controllers/apiV1Controller'
import multer from "multer";

const router = express.Router();

const storage = multer.memoryStorage(); // ⬅️ Enables buffer access
const upload = multer({ storage });

// -------------------- WhatsApp API --------------------
router.get("/:phoneNumberId/api/v1/getMessages/:whatsappNumber", apiV1Controller.getMessages);
router.get("/:phoneNumberId/api/v1/getMessageTemplates", apiV1Controller.getMessageTemplates);
router.get("/:phoneNumberId/api/v1/getContacts", apiV1Controller.getContacts);
router.get("/getMedia", apiV1Controller.getMedia);

router.post("/:phoneNumberId/api/v1/updateContactAttributes/:whatsappNumber", apiV1Controller.updateContactAttributes);
router.post("/:phoneNumberId/api/v1/updateContactAttributesForMultiContacts", apiV1Controller.updateContactAttributesForMultiContacts);
router.post("/:phoneNumberId/api/v1/rotateToken", apiV1Controller.rotateToken);
router.post("/:phoneNumberId/api/v1/addContact/:whatsappNumber", apiV1Controller.addContact);
router.post("/:phoneNumberId/api/v1/sendSessionFile/:whatsappNumber", upload.single("file"), apiV1Controller.sendSessionFile);
router.post("/:phoneNumberId/api/v1/sendSessionMessage/:whatsappNumber", apiV1Controller.sendSessionMessage);
router.post("/:phoneNumberId/api/v1/sendTemplateMessage", apiV1Controller.sendTemplateMessage);
router.post("/:phoneNumberId/api/v1/sendTemplateMessages", apiV1Controller.sendTemplateMessages);
router.post("/:phoneNumberId/api/v1/sendTemplateMessagesCSV", apiV1Controller.sendTemplateMessagesCSV);
router.post("/:phoneNumberId/api/v1/sendInteractiveButtonsMessage", apiV1Controller.sendInteractiveButtonsMessage);
router.post("/:phoneNumberId/api/v1/sendInteractiveListMessage", apiV1Controller.sendInteractiveListMessage);
router.post("/:phoneNumberId/api/v1/assignOperator", apiV1Controller.assignOperator);
router.post("/:phoneNumberId/api/v1/assignTeam", apiV1Controller.assignTeam);
router.post("/:phoneNumberId/api/v1/updateChatStatus", apiV1Controller.updateChatStatus);

router.get("/:phoneNumberId/api/v1/chatbots", apiV1Controller.getChatbots);
router.post("/:phoneNumberId/api/v1/chatbots/start", apiV1Controller.startChatbot);
router.post("/:phoneNumberId/api/v1/chatbots/update", apiV1Controller.updateChatbot);
router.post("/:phoneNumberId/api/v1/chatbots/stop", apiV1Controller.stopChatbot);

// -------------------- WhatsApp Payment API --------------------
router.post("/:phoneNumberId/api/v1/order_details", apiV1Controller.orderDetails);
router.post("/:phoneNumberId/api/v1/order_details_template", apiV1Controller.orderDetailsTemplate);
router.post("/:phoneNumberId/api/v1/order_status", apiV1Controller.orderStatus);
router.post("/:phoneNumberId/api/v1/order_status_template", apiV1Controller.orderStatusTemplate);
router.post("/:phoneNumberId/api/v1/checkout_button_template", apiV1Controller.checkoutButtonTemplate);
router.get("/:phoneNumberId/api/v1/order_details/:referenceId", apiV1Controller.getOrderDetailsByReferenceId);
router.get("/:phoneNumberId/api/v1/payment_status/:referenceId", apiV1Controller.getPaymentStatusByReferenceId);

export default router; 