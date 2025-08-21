import express from "express";
import {
updateBusinessSettings,
getBusinessSettings,
saveAccountDetails,
getAccountDetails
} from "../controllers/businessAccountController"
import { validateAccountDetails } from "../helpers/validation/accountValidation";

//const upload = multer({ dest: "uploads/" });
const router = express.Router();
import multer from "multer";

const upload = multer({ dest: "uploads/" });

// Existing routes for business settings (WABA-specific)
router.post("/", upload.single("file"), updateBusinessSettings);
router.get("/", getBusinessSettings);

// New routes for general account details with validation
router.post("/account-details", validateAccountDetails, saveAccountDetails);
router.get("/account-details", getAccountDetails);

//router.put("/:userId", getBusinessSettings);

export default router;
