// @ts-nocheck
import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../models/prismaClient';
import passport from 'passport';
import "../config/passportConfig";
import axios from 'axios';
export const registerUser = async (req: Request, res: Response) => {
  const { email, password, role } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, role },
    });
    res.status(201).send("User Created successfully");
  } catch (error: unknown) {
    if (error instanceof Error) {
        res.status(500).send("An unknown error occurred."); // Safely access the message property
    } else {
        res.status(500).send('An unknown error occurred.');
    }
}

};

export const loginUser = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user?.findUnique({ where: { email } });
    if (!user) return res.status(401).send('Invalid email');

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).send('Invalid pw');

    const token = jwt.sign({ userId: user.id, role: user.role }, `${process.env.JWT_SECRET}`, { expiresIn: '1h' });
    res.status(200).json({ token,  user: {
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
    }, });
  } catch (error: unknown) {
    if (error instanceof Error) {
        res.status(500).send('An unknown error occurred.'); // Safely access the message property
    } else {
        res.status(500).send('An unknown error occurred.');
    }
}

};



export const googleAuth = passport.authenticate('google', {
  scope: ['profile', 'email'],
});

export const googleCallback = [
  passport.authenticate('google', { session: false,accessType: "offline", // Request refresh token
    prompt: "consent"}),
  async (req: any, res: Response) => {
    try {
      const user = req.user;
      // Generate a JWT
      const token = jwt.sign(
        { userId: user.id, role: user.role },
        process.env.JWT_SECRET as string,
        { expiresIn: '1h' }
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
      console.error('Google Callback Error:', error);
      res.status(500).send('Authentication failed');
    }
  },
];


export const getAccessToken = async (req: Request, res: Response): Promise<void> => {
  const { code } = req.body;

  if (!code) {
      res.status(400).json({ error: "Authorization code is required" });
      return;
  }

  try {
      const response = await axios.get(`${process.env.META_BASE_URL}/oauth/access_token`, {
          params: {
              client_id: process.env.META_APP_ID,
              client_secret: process.env.META_APP_SECRET,
              code: code,
              redirect_uri: process.env.FB_REDIRECT_URI,
          },
      });

      res.json({ success: true, accessToken: response.data.access_token });
  } catch (error: any) {
      console.error("Error fetching access token:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to fetch access token" });
  }
};