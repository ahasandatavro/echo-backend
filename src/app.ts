import dotenv, { config } from "dotenv";
dotenv.config();
import "./config/passportConfig";
import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import cookieParser from "cookie-parser";
import nodeRoutes from "./routes/nodeRoute";
import authRoutes from "./routes/authRoute";
import metaWebhookRoutes from "./routes/metaWebhookRoute";
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
import businessPhoneNumberRoutes from "./routes/businessPhoneNumberRoute";
import paymentRoutes from "./routes/payment.routes";
import { Server } from "socket.io";
import { authenticateJWT } from "./middlewares/authMiddleware"
import passport from "passport";
import multer from "multer";
import { s3 } from "./config/s3Config";
import http from "http";
import { prisma } from "./models/prismaClient";
import hubspotRoutes from "./routes/hubspotRoute";
import webhookRoutes from "./routes/webhookRoute";
import notificationSettingsRoutes from "./routes/notificationSettingsRoute";
import agenda, { initializeAgenda } from "./config/agenda";
import apiV1Route from "./routes/apiV1Route";

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

io.on("connection", (socket) => {
  let activeEmail: string | null = null;

  socket.on("userOnline", async ({ email }) => {
    if (!email) return;

    activeEmail = email;

    try {
      await prisma.user.update({
        where: { email },
        data: { isOnline: true },
      });

      io.emit("userStatusChanged", { email, isOnline: true });
    } catch (err) {
      console.error("Error setting user online:", err);
    }
  });

  socket.on("userOffline", async ({ email }) => {
    if (!email) return;

    try {
      await prisma.user.update({
        where: { email },
        data: { isOnline: false, lastActive: new Date() },
      });

      io.emit("userStatusChanged", { email, isOnline: false });
    } catch (err) {
      console.error("Error setting user offline:", err);
    }
  });

  socket.on("disconnect", async () => {
    if (!activeEmail) return;

    try {
      await prisma.user.update({
        where: { email: activeEmail },
        data: { isOnline: false, lastActive: new Date() },
      });

      io.emit("userStatusChanged", { email: activeEmail, isOnline: false });
    } catch (err) {
      console.error("Error on disconnect:", err);
    }
  });

  socket.on("newChat", async ({ email }) => {
    if (!email) return;

    try {
      const sender = await prisma.user.findUnique({
        where: { email },
        include: { createdUsers: true, createdBy: true }
      });

      if (!sender) return;

      let recipients: string[] = [];

      if (!sender.agent) {
        // 🔔 If not an agent, notify all users created by this user (agents)
        const createdAgents = await prisma.user.findMany({
          where: {
            createdById: sender.id,
            agent: true
          },
          select: { email: true }
        });

        recipients = createdAgents.map((user) => user.email);
      } else if (sender.createdById) {
        // 🔔 If agent, notify:
        // 1. Other agents created by the same creator
        // 2. The creator themself
        const otherAgents = await prisma.user.findMany({
          where: {
            createdById: sender.createdById,
            agent: true,
            NOT: { email: sender.email }
          },
          select: { email: true }
        });

        const creator = await prisma.user.findUnique({
          where: { id: sender.createdById },
          select: { email: true }
        });

        recipients = [
          ...otherAgents.map((a) => a.email),
          ...(creator?.email ? [creator.email] : [])
        ];
      }

      // ✅ Emit event to each recipient email
      recipients.forEach((recipientEmail) => {
        io.emit("newChat", { email: recipientEmail });
      });

    } catch (err) {
      console.error("Error broadcasting newChat:", err);
    }
  });


  socket.on("chatAssignedToAgent", async ({ assignedToEmail, assignedByEmail, contactName }) => {
    if (!assignedToEmail || !assignedByEmail) return;

    try {
      const assignee = await prisma.user.findUnique({
        where: { email: assignedByEmail },
        include: { createdBy: true }
      });

      if (!assignee) return;

      let recipients: string[] = [];

      if (!assignee.agent) {
        // If creator (not agent), notify all their agents
        const createdAgents = await prisma.user.findMany({
          where: {
            createdById: assignee.id,
            agent: true
          },
          select: { email: true }
        });

        recipients = createdAgents.map((u) => u.email);
      } else if (assignee.createdById) {
        // Notify other agents created by same creator and the creator
        const otherAgents = await prisma.user.findMany({
          where: {
            createdById: assignee.createdById,
            agent: true,
            NOT: { email: assignedToEmail }
          },
          select: { email: true }
        });

        const creator = await prisma.user.findUnique({
          where: { id: assignee.createdById },
          select: { email: true }
        });

        recipients = [
          ...otherAgents.map((a) => a.email),
          ...(creator?.email ? [creator.email] : [])
        ];
      }

      // Emit notification with both emails
      for (const email of recipients) {
        io.emit("chatAssignedToAgent", {
          email,
          assignedToEmail,
          assignedByEmail,
          contactName
        });
      }

    } catch (err) {
      console.error("Error in chatAssignedToAgent socket:", err);
    }
  });

  socket.on("chatAssignedToTeam", async ({ email, assignedByEmail, selectedContact, teamIds }) => {
    try {
      if (!teamIds?.length) return;

      // ✅ Find agents belonging to any of the assigned teams
      const agents = await prisma.user.findMany({
        where: {
          teams: {
            some: {
              id: { in: teamIds }
            }
          },
          email: { not: email } // Exclude the sender
        },
        select: { email: true }
      });

      for (const agent of agents) {
          io.emit("chatAssignedToTeam", {
          email: agent.email,
          assignedByEmail,
          selectedContact
        });
      }
    } catch (err) {
      console.error("Error broadcasting chatAssignedToTeam:", err);
    }
  });
});




const upload = multer({
  storage: multer.memoryStorage(),
});

// Configure CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
  exposedHeaders: ["Set-Cookie"],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Add cookie parser middleware
app.use(cookieParser());

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
app.use("/businessAccount",authenticateJWT, businessAccountRoutes);
app.use("/businessPhoneNumbers", authenticateJWT, businessPhoneNumberRoutes);
app.use("/metaWebhook",metaWebhookRoutes);
app.use("/webhooks",authenticateJWT,webhookRoutes);
app.use("/notificationSettings",authenticateJWT,notificationSettingsRoutes);
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
app.use("/apiV1",authenticateJWT,apiV1Route);
app.use("/payments", authenticateJWT, paymentRoutes);
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

// Initialize Agenda
initializeAgenda().catch((error) => {
  console.error('Failed to initialize Agenda:', error);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
export { io };
