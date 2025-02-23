import axios from "axios";
import dotenv from "dotenv";
import { Request, Response } from "express";
dotenv.config();

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.BASE_URL +"/whatsApp/callback"; // e.g., https://yourdomain.com/api/whatsapp/callback

/**
 * Generate WhatsApp Embedded Signup URL
 */
export const getSignupUrl = (req:Request, res:Response) => {
    const signupUrl = `${process.env.META_BASE_URL}/dialog/oauth?client_id=${process.env.META_APP_ID}&redirect_uri=${REDIRECT_URI}&state=whatsapp_signup&scope=business_management,whatsapp_business_management,whatsapp_business_messaging`;

    res.json({ signupUrl });
};

/**
 * Handle WhatsApp Signup Callback & Exchange Code for Access Token
 */
export const handleCallback = async (req:Request, res:Response  ) => {
    const { code, error } = req.query;

    if (error) {
        return res.status(400).json({ error: "Facebook OAuth failed", details: error });
    }

    try {
        // Exchange authorization code for access token using Axios
        const tokenResponse = await axios.get(`https://graph.facebook.com/v17.0/oauth/access_token`, {
            params: {
                client_id: process.env.META_APP_ID,
                redirect_uri: REDIRECT_URI,
                client_secret: process.env.META_APP_SECRET,
                code: code
            }
        });

        if (!tokenResponse.data.access_token) {
            throw new Error("Failed to get access token");
        }

        res.json({ access_token: tokenResponse.data.access_token });
    } catch (err:any) {
        res.status(500).json({ error: "Failed to authenticate", details: err.response?.data || err.message });
    }
};
