import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../models/prismaClient";
import passport from "passport";
import "../config/passportConfig";
import axios from "axios";

export const registerUser = async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, phoneNumber, role } = req.body;
  try {
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      return res.status(400).send("Email already in use.");
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phoneNumber,
        role:role,
      },
    });
    
    res.status(201).send("User Created successfully");
  } catch (error: unknown) {
    if (error instanceof Error) {
      res.status(500).send("An unknown error occurred."); // Safely access the message property
    } else {
      res.status(500).send("An unknown error occurred.");
    }
  }
};

export const loginUser = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user?.findUnique({ where: { email } });
    if (!user) return res.status(401).send("Invalid email");

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).send("Invalid pw");

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      `${process.env.JWT_SECRET}`,
      { expiresIn: "1h" }
    );
    res.status(200).json({
      token,
      user: {
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        image: user.image,
        phoneNumber: user.phoneNumber,
        businessAddress: user.businessAddress,
        businessDescription: user.businessDescription,
        businessIndustry: user.businessIndustry,
        website1: user.website1,
        website2: user.website2,
        tags: user.tags,
        attributes: user.attributes,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      res.status(500).send("An unknown error occurred."); // Safely access the message property
    } else {
      res.status(500).send("An unknown error occurred.");
    }
  }
};

export const googleAuth = passport.authenticate("google", {
  scope: ["profile", "email"],
});

export const googleCallback = [
  passport.authenticate("google", {
    session: false,
    accessType: "offline", // Request refresh token
    prompt: "consent",
  }),
  async (req: any, res: Response) => {
    try {
      const user = req.user;
      // Generate a JWT
      const token = jwt.sign(
        { userId: user.id, role: user.role },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" }
      );

      // Send the token and user data to the parent window
      res.send(`
        <script>
          window.opener.postMessage({
            token: '${token}',
            user: {
              name: '${user.name}',
              email: '${user.email}',
              image: '${user.imageUrl}' // Assuming user has an imageUrl property
            }
          }, '*');
          window.close();
        </script>
      `);
    } catch (error) {
      console.error("Google Callback Error:", error);
      res.status(500).send("Authentication failed");
    }
  },
];

export const getAccessToken = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { code, wabaId, phoneNumberId } = req.body;

  if (!code) {
    return res.status(400).json({ error: "Authorization code is required" });
  }

  try {
    const tokenResponse = await axios.get(
      `${process.env.META_BASE_URL}/oauth/access_token`,
      {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: process.env.REDIRECT_URI,
          code,
        },
      }
    );
    const businessToken = tokenResponse.data.access_token;

    const businessAccountResponse = await axios.get(
      `https://graph.facebook.com/v22.0/${wabaId}`,
      {
        params: { fields: "name,timezone_id", access_token: businessToken },
      }
    );

    const timeZone = businessAccountResponse.data.timezone;
    const businessName = businessAccountResponse.data.business_name;
    const businessVerification =
      businessAccountResponse.data.business_verification;
    const accountStatus = businessAccountResponse.data.account_status;
    const paymentMethod = businessAccountResponse.data.payment_method;

    await axios.post(
      `${process.env.META_BASE_URL}/${wabaId}/subscribed_apps`,
      null,
      { headers: { Authorization: `Bearer ${businessToken}` } }
    );

    await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/register`,
      {
        messaging_product: "whatsapp",
        pin: process.env.DESIRED_PIN,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${businessToken}`,
        },
      }
    );

    await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: process.env.WHATSAPP_USER_NUMBER,
        type: "text",
        text: { body: "Your message text here" },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${businessToken}`,
        },
      }
    );

    const phoneDataResponse = await axios.get(
      `https://graph.facebook.com/v16.0/${phoneNumberId}`,
      {
        params: {
          fields: "display_phone_number,verified_name",
          access_token: businessToken,
        },
      }
    );

    const phoneNumberFromAPI =
      phoneDataResponse.data.display_phone_number || "";
    const displayNameFromAPI =
      phoneDataResponse.data.verified_name || "Default Name";
    const connectionStatusFromAPI = "CONNECTED";
    const subscriptionFromAPI = "Free";

    const user: any = req.user;
    const userId: any = user?.userId;
    if (!userId) {
      console.warn("User ID not found in request; skipping DB update.");
      return res
        .status(200)
        .json({ success: true, warning: "No user ID found" });
    }

    let businessAccount = await prisma.businessAccount.findFirst({
      where: { userId, metaWabaId: wabaId },
    });

    if (!businessAccount) {
      businessAccount = await prisma.businessAccount.create({
        data: {
          userId,
          metaAccessToken: businessToken,
          metaWabaId: wabaId,
          timeZone,
          businessName,
          businessVerification,
          accountStatus,
          paymentMethod,
        },
      });
    } else {
      businessAccount = await prisma.businessAccount.update({
        where: { id: businessAccount.id },
        data: {
          metaAccessToken: businessToken,
          metaWabaId: wabaId,
          timeZone,
          businessName,
          businessVerification,
          accountStatus,
          paymentMethod,
        },
      });
    }

    const existingPhone = await prisma.businessPhoneNumber.findFirst({
      where: {
        businessAccountId: businessAccount.id,
        metaPhoneNumberId: phoneNumberId,
      },
    });

    if (existingPhone) {
      return res
        .status(400)
        .json({
          error: "Phone number already exists for this business account",
        });
    }

    await prisma.businessPhoneNumber.create({
      data: {
        businessAccountId: businessAccount.id,
        metaPhoneNumberId: phoneNumberId,
        phoneNumber: phoneNumberFromAPI,
        displayName: displayNameFromAPI,
        connectionStatus: connectionStatusFromAPI,
        subscription: subscriptionFromAPI,
      },
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(
      "Error fetching access token:",
      error.response?.data || error.message
    );
    if (!res.headersSent) {
      return res.status(500).json({ error: "Failed to fetch access token" });
    }
    return res; // Ensure a valid Response is returned
  }
};
