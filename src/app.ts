import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import nodeRoutes from "./routes/nodeRoute";
import authRoutes from "./routes/authRoute";
import webhookRoutes from "./routes/webhookRoute";
import replyMaterialRoutes from "./routes/replyMaterialRoute";
import routingMaterialRoutes from "./routes/routingMaterialRoute";
import keywordRoutes from "./routes/keywordRoute";
import variableRoute from "./routes/variableRoute";
import gdriveRoutes from "./routes/gdriveRoute";
import contactRoutes from "./routes/contactRoute";
import analyticsRoutes from "./routes/analyticsRoute";
import userRoutes from "./routes/userRoute";
import templateRoutes from "./routes/templateRoute";
import conversationRoutes from "./routes/conversationRoute";
import teamRoutes from "./routes/teamRoutes";
import defaultActionSettingsRoutes from "./routes/defaultActionSettingsRoute";
import agentRoutes from "./routes/agentRoute";
import businessAccountRoutes from "./routes/businessAccountRoute";
import whatsAppRoute from "./routes/whatsAppRoute";
import ruleRoutes from "./routes/ruleRoute";
import { Server } from "socket.io";
import { authenticateJWT } from "./middlewares/authMiddleware"
import passport from "passport";
import dotenv, { config } from "dotenv";
import "./config/passportConfig";
import multer from "multer";
import { s3 } from "./config/s3Config";
import http from "http";
import hubspotRoutes from "./routes/hubspotRoute";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL, // Allow only the frontend URL
    methods: ["GET", "POST"],
  },
});
declare global {
  var io: Server;
}

// ✅ Assign the properly typed `io` instance to `global`
global.io = io;
app.set("socketio", io);

const upload = multer({
  storage: multer.memoryStorage(),
});

app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(
  bodyParser.urlencoded({
    limit: "50mb",
    extended: true,
    parameterLimit: 50000,
  })
);
app.use(bodyParser.text({ limit: "200mb" }));
app.use(express.json());
app.use(passport.initialize());
app.use("/auth", authRoutes);
app.use("/nodes", authenticateJWT,nodeRoutes);
app.use("/users", authenticateJWT,userRoutes);
app.use("/agents", authenticateJWT,agentRoutes);
app.use("/businessAccount",authenticateJWT, businessAccountRoutes)
app.use("/webhook",webhookRoutes);
app.use("/variables", authenticateJWT,variableRoute);
app.use("/replyMaterials",authenticateJWT,replyMaterialRoutes);
app.use("/routingMaterials",authenticateJWT,routingMaterialRoutes);
app.use("/defaultActionSettings",authenticateJWT, defaultActionSettingsRoutes)
app.use('/keyword',authenticateJWT,keywordRoutes);
app.use('/gdrive',authenticateJWT,gdriveRoutes);
app.use('/contacts',authenticateJWT,contactRoutes);
app.use("/conversations", authenticateJWT,conversationRoutes);
app.use('/analytics', authenticateJWT,analyticsRoutes);
app.use("/teams", authenticateJWT,teamRoutes);
app.use("/templates", authenticateJWT,templateRoutes);
app.use("/whatsApp", authenticateJWT,whatsAppRoute);
app.use("/rules", authenticateJWT, ruleRoutes);
app.use("/hubspot",hubspotRoutes);
app.post("/upload",upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const fileKey = `${Date.now()}-${req.file.originalname}`;
    const uploadParams = {
      Bucket: process.env.DO_SPACES_BUCKET || "", // Bucket name from .env
      Key: fileKey,
      Body: req.file.buffer,
      ACL: "public-read", // Make file publicly accessible
      ContentType: req.file.mimetype,
    };

    const result = await s3.upload(uploadParams).promise();

    res.status(200).json({
      message: "File uploaded successfully",
      fileUrl: result.Location,
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).json({ message: "Failed to upload file", error });
  }
});
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
export { io };