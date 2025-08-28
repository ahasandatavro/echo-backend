import express from "express";
import * as apiV1Controller from '../controllers/apiV1Controller'
import multer from "multer";

const router = express.Router();

const storage = multer.memoryStorage(); // ⬅️ Enables buffer access
const upload = multer({ storage });

// -------------------- WhatsApp API --------------------
router.get("/:phoneNumberId/getMessages/:whatsappNumber", apiV1Controller.getMessages);
router.get("/:phoneNumberId/getMessageTemplates", apiV1Controller.getMessageTemplates);
router.get("/:phoneNumberId/getContacts", apiV1Controller.getContacts);
router.get("/getMedia", apiV1Controller.getMedia);

router.post("/:phoneNumberId/updateContactAttributes/:whatsappNumber", apiV1Controller.updateContactAttributes);
router.post("/:phoneNumberId/updateContactAttributesForMultiContacts", apiV1Controller.updateContactAttributesForMultiContacts);
router.post("/:phoneNumberId/api/v1/rotateToken", apiV1Controller.rotateToken);
router.post("/:phoneNumberId/addContact/:whatsappNumber", apiV1Controller.addContact);
router.post("/:phoneNumberId/sendSessionFile/:whatsappNumber", upload.single("file"), apiV1Controller.sendSessionFile);
router.post("/:phoneNumberId/sendSessionMessage/:whatsappNumber", apiV1Controller.sendSessionMessage);
router.post("/:phoneNumberId/sendTemplateMessage", apiV1Controller.sendTemplateMessage);
router.post("/:phoneNumberId/sendTemplateMessages", apiV1Controller.sendTemplateMessages);
router.post("/:phoneNumberId/sendTemplateMessagesCSV", apiV1Controller.sendTemplateMessagesCSV);
router.post("/:phoneNumberId/sendInteractiveButtonsMessage", apiV1Controller.sendInteractiveButtonsMessage);
router.post("/:phoneNumberId/sendInteractiveListMessage", apiV1Controller.sendInteractiveListMessage);
router.post("/:phoneNumberId/assignOperator", apiV1Controller.assignOperator);
router.post("/:phoneNumberId/assignTeam", apiV1Controller.assignTeam);
router.post("/:phoneNumberId/updateChatStatus", apiV1Controller.updateChatStatus);

router.get("/:phoneNumberId/chatbots", apiV1Controller.getChatbots);
router.post("/:phoneNumberId/chatbots/start", apiV1Controller.startChatbot);
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