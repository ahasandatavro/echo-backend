import { Request, Response, RequestHandler } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../models/prismaClient";
import passport from "passport";
import "../config/passportConfig";
import axios from "axios";
import { sendWelcomeEmail, generateVerificationToken, sendPasswordResetEmail } from "../services/emailService";
import crypto from 'crypto';
import { generateTokens, setTokenCookies } from "../utils/tokenUtils";
import { isGoogleOAuthConfigured } from "../config/oauthConfig";

const googleOAuthDisabledPopupHtml = () => {
  const origin = process.env.FRONTEND_URL || "";
  return `<!DOCTYPE html>
<html>
<head><title>Google Auth unavailable</title></head>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage({ error: 'Google sign-in is not configured on this server.' }, '${origin}');
  }
  window.close();
</script>
<p>Google sign-in is not available. You can close this window.</p>
</body>
</html>`;
};

const googleOAuthDisabledHandler: RequestHandler = (_req, res) => {
  res.status(503).send(googleOAuthDisabledPopupHtml());
};

const googleOAuthDisabledJson: RequestHandler = (_req, res) => {
  res.status(503).json({ error: "Google sign-in is not configured on this server." });
};

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
    const verificationToken = generateVerificationToken();

    // Create free payment and package subscription in a single transaction
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7); // 7 days from now

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create user
      const newUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phoneNumber,
          role: role,
          emailVerified: false,
          verificationToken,
        },
      });

      // 2. Create free payment record
      const payment = await tx.payment.create({
        data: {
          userId: newUser.id,
          orderId: `free_${Date.now()}_${newUser.id}`,
          amount: 0,
          currency: 'INR',
          paymentType: 'free-signup',
          metadata: {
            packageName: 'Free',
            packageDuration: '7days'
          },
          status: 'SUCCESS'
        }
      });

      // 3. Create free package subscription using the payment ID
      const packageSubscription = await tx.packageSubscription.create({
        data: {
          userId: newUser.id,
          paymentId: payment.id,
          packageName: 'Free',
          startDate,
          endDate,
          isActive: true
        }
      });

      return { newUser, payment, packageSubscription };
    });

    // Send welcome email with verification link
    try {
      await sendWelcomeEmail(result.newUser.email, result.newUser.firstName || 'User', verificationToken);
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // Don't fail the registration if email fails
    }

    res.status(201).send("User Created successfully. Please check your email to verify your account.");
  } catch (error: unknown) {
    console.log(error);
    if (error instanceof Error) {
      res.status(500).send("An unknown error occurred.");
    } else {
      res.status(500).send("An unknown error occurred.");
    }
  }
};


export const verifyEmail = async (req: Request, res: Response) => {
  const { token } = req.body;

  try {
    // First find the user to check their password
    const user = await prisma.user.findFirst({
      where: {
        verificationToken: token as string,
        emailVerified: false
      }
    });

    if (!user) {
      return res.status(400).send({ success: false, message: "Invalid or already verified token."});
    }

    // Generate reset token if password is empty
    let resetToken = null;
    let resetTokenExpiresAt = null;
    if (!user.password || user.password === "") {
      resetToken = crypto.randomBytes(32).toString('hex');
      resetTokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
    }

    // Update the user
    const result = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationToken: null,
        resetToken,
        resetTokenExpiresAt,
      },
    });

    if (resetToken) {
      // If we generated a reset token, redirect to password reset
      return res.status(301).send({
        success: true,
        message: "Email verified successfully. Please set your password.",
        redirectUrl: `${process.env.FRONTEND_URL}/#/reset-password?token=${resetToken}`
      });
    }

    res.status(200).send({success: true, message: "Email verified successfully. You can now log in."});
  } catch (error) {
    console.error("Error verifying email:", error);
    res.status(500).send({success: false, message: "An error occurred while verifying your email."});
  }
};

export const loginUser = async (req: Request, res: Response) => {
  const { email, password, rememberMe } = req.body;
  try {
    const user = await prisma.user?.findUnique({ where: { email } });
    if (!user) return res.status(401).send("Invalid email");

    if (!user.emailVerified) {
      return res.status(401).json({
        error: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email address before logging in. Check your inbox for a verification link, or request a new one.",
        code: "EMAIL_NOT_VERIFIED"
      });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).send("Invalid password");

    const { accessToken, refreshToken } = generateTokens(user.id, user.role, rememberMe);

    // Fetch active package subscription
    const activePackage = await prisma.packageSubscription.findFirst({
      where: { userId: user.id, isActive: true },
      orderBy: { endDate: 'desc' },
      include: { payment: true }
    });

    // Set tokens in HTTP-only cookies
    setTokenCookies(res, accessToken, refreshToken, rememberMe);

    res.status(200).json({
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
        package: activePackage ? {
          packageName: activePackage.packageName,
          startDate: activePackage.startDate,
          endDate: activePackage.endDate,
          isActive: activePackage.isActive,
          price:activePackage.payment.amount
        } : null
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      res.status(500).send("An unknown error occurred.");
    } else {
      res.status(500).send("An unknown error occurred.");
    }
  }
};

export const googleAuth = isGoogleOAuthConfigured()
  ? passport.authenticate("google", {
      scope: ["profile", "email"],
    })
  : googleOAuthDisabledJson;

export const googleCallback = isGoogleOAuthConfigured()
  ? [
  passport.authenticate("google", {
    session: false,
    accessType: "offline", // Request refresh token
    prompt: "consent",
  }),
  async (req: any, res: Response) => {
    try {
      const user = req.user;
      // Generate tokens
      const { accessToken, refreshToken } = generateTokens(user.id, user.role, true); // Default to remember me for Google auth
 
      
      // Set tokens in HTTP-only cookies
      setTokenCookies(res, accessToken, refreshToken, true);
const userData=await prisma.user.findUnique({ where: { id: user.id } });
const activePackage = await prisma.packageSubscription.findFirst({
  where: { userId: user.id, isActive: true },
  orderBy: { endDate: 'desc' },
  include: { payment: true }
});
let packageData=null;
if(activePackage){
 packageData={
  packageName: activePackage.packageName,
  startDate: activePackage.startDate,
  endDate: activePackage.endDate,
  isActive: activePackage.isActive
    }}
      // Redirect to frontend with success message
      const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Auth Success</title>
      </head>
      <body>
        <script>
          // Send message to parent window
          window.opener.postMessage({
            token: '${accessToken}',
            user: {
              email: '${user.email}',
              id: '${user.id}',
               package: ${JSON.stringify(packageData)}
            }
          }, '${process.env.FRONTEND_URL}');
          
          // Close the popup
          window.close();
        </script>
        <p>Authentication successful! You can close this window.</p>
      </body>
      </html>
    `;
    res.send(html);
     // res.redirect(`${process.env.FRONTEND_URL}/#`);
    } catch (error) {
      const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Auth Error</title>
      </head>
      <body>
        <script>
          window.opener.postMessage({
            error: 'Authentication failed'
          }, '${process.env.FRONTEND_URL}');
          window.close();
        </script>
        <p>Authentication failed! You can close this window.</p>
      </body>
      </html>
    `;
    
    res.send(errorHtml);
      // console.error("Google Callback Error:", error);
      // res.redirect(`${process.env.FRONTEND_URL}/#/auth/error`);
    }
  },
]
  : [googleOAuthDisabledHandler];
const attachOriginalUser = (req: any, res: Response, next: any) => {
  req.originalUserId = req.user.userId; // store original user before passport overwrites it
  next();
};

export const googleCallbackSheets = isGoogleOAuthConfigured()
  ? [
  attachOriginalUser,
  passport.authenticate("google-sheets", {
    session: false
  }),
  async (req: any, res: Response) => {
    try {
      const user = req.user;
      // Generate tokens
     // const { accessToken, refreshToken } = generateTokens(user.id, user.role, true); // Default to remember me for Google auth
 
      
      // Set tokens in HTTP-only cookies
      //setTokenCookies(res, accessToken, refreshToken, true);

      // Redirect to frontend with success message
      const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Auth Success</title>
      </head>
      <body>
        <script>
          // Send message to parent window
          window.opener.postMessage({
            token: '123',
            user: {
              email: '${user.email}',
              id: '${user.id}'
            }
          }, '${process.env.FRONTEND_URL}');
          
          // Close the popup
          window.close();
        </script>
        <p>Authentication successful! You can close this window.</p>
      </body>
      </html>
    `;
    
    res.send(html);
     // res.redirect(`${process.env.FRONTEND_URL}/#`);
    } catch (error) {
      const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Auth Error</title>
      </head>
      <body>
        <script>
          window.opener.postMessage({
            error: 'Authentication failed'
          }, '${process.env.FRONTEND_URL}');
          window.close();
        </script>
        <p>Authentication failed! You can close this window.</p>
      </body>
      </html>
    `;
    
    res.send(errorHtml);
      // console.error("Google Callback Error:", error);
      // res.redirect(`${process.env.FRONTEND_URL}/#/auth/error`);
    }
  },
]
  : [googleOAuthDisabledHandler];

//get metaToken
export const getAccessToken = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { code, wabaId, phoneNumberId } = req.body;
  const user:any=req.user;
  const dbUser=await prisma.user.findFirst({
    where: { id: user.userId },
  })
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
    const rawNumber = phoneNumberFromAPI;

    // remove all plus‐signs and spaces
    const cleanedNumber = rawNumber.replace(/[+\s]/g, "");
    const existingPhone = await prisma.businessPhoneNumber.findFirst({
      where: {
        phoneNumber: cleanedNumber,
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
        phoneNumber: cleanedNumber,
        displayName: displayNameFromAPI,
        connectionStatus: connectionStatusFromAPI,
        subscription: subscriptionFromAPI,
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: {
        selectedPhoneNumberId: phoneNumberId,
        selectedWabaId: wabaId,
        metaBusinessToken: businessToken,
      },
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(
      "Error fetching access token:",
      error.response?.data?.error?.message || error.message
    );
    if (!res.headersSent) {
      return res.status(500).json({ error: error.response?.data?.error?.message || "Failed to fetch access token" });
    }
    return res; // Ensure a valid Response is returned
  }
};

// GET /api/auth/google-token
// GET /api/auth/google-token
// GET /api/auth/google-token
export const getGoogleToken = async (req: any, res: Response) => {
  try {
    const userId = req.user.userId; // From your JWT middleware
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.accessToken) {
      return res.status(403).json({ 
        message: "No Google access token found. Please sign in with Google again.",
        success: false 
      });
    }

    // Check if token is expired (accessTokenExpiresAt is Unix timestamp)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (user.accessTokenExpiresAt && currentTimestamp > user.accessTokenExpiresAt) {
      // Token is expired, need to refresh
      try {
        const newTokens:any = await refreshGoogleToken(user.refreshToken!);
        
        // Update user with new tokens
        await prisma.user.update({
          where: { id: userId },
          data: {
            accessToken: newTokens.access_token,
            refreshToken: newTokens.refresh_token || user.refreshToken,
            accessTokenExpiresAt: Math.floor(Date.now() / 1000) + newTokens.expires_in
          }
        });
        
        return res.status(200).json({ 
          accessToken: newTokens.access_token,
          success: true 
        });
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
        return res.status(403).json({ 
          message: "Google token expired. Please sign in again.",
          success: false 
        });
      }
    }

    return res.status(200).json({ 
      accessToken: user.accessToken,
      success: true 
    });
  } catch (error) {
    console.error("Error fetching Google token:", error);
    return res.status(500).json({ 
      message: "Failed to fetch Google token", 
      success: false 
    });
  }
};

// Helper function to refresh Google tokens
async function refreshGoogleToken(refreshToken: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Token refresh error:', errorText);
    throw new Error('Failed to refresh token');
  }

  return response.json();
}

export const requestPasswordReset = async (req: Request, res: Response) => {
  const { email } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal that the email doesn't exist
      return res.status(200).json({
        success: true,
        message: "If your email is registered, you will receive a password reset link."
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiresAt = new Date(Date.now() + 3600000); // 1 hour from now

    await prisma.user.update({
      where: { email },
      data: {
        resetToken,
        resetTokenExpiresAt,
      },
    });

    try {
      await sendPasswordResetEmail(email, user.firstName || 'User', resetToken);
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError);
      return res.status(500).json({
        success: false,
        message: "Failed to send password reset email. Please try again later."
      });
    }

    res.status(200).json({
      success: true,
      message: "If your email is registered, you will receive a password reset link."
    });
  } catch (error) {
    console.error("Error requesting password reset:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while processing your request."
    });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;

  try {
    const result = await prisma.user.updateMany({
      where: {
        resetToken: token,
        resetTokenExpiresAt: {
          gt: new Date(), // Token hasn't expired
        },
      },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        resetToken: null,
        resetTokenExpiresAt: null,
      },
    });

    if (result.count === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token."
      });
    }

    res.status(200).json({
      success: true,
      message: "Password has been reset successfully. You can now log in with your new password."
    });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while resetting your password."
    });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ message: 'Refresh token not found' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET || 'default-refresh-secret') as { userId: number, role: string, rememberMe: boolean };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.role, decoded.rememberMe);

    // Fetch active package subscription
    const activePackage = await prisma.packageSubscription.findFirst({
      where: { userId: user.id, isActive: true },
      orderBy: { endDate: 'desc' }
    });

    // Set new tokens in HTTP-only cookies
    setTokenCookies(res, accessToken, newRefreshToken, decoded.rememberMe);

    res.status(200).json({
      message: 'Tokens refreshed successfully',
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
        package: activePackage ? {
          packageName: activePackage.packageName,
          startDate: activePackage.startDate,
          endDate: activePackage.endDate,
          isActive: activePackage.isActive
        } : null
      }
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid refresh token' });
  }
};

export const resendVerificationEmail = async (req: Request, res: Response) => {
  const { email } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal that the email doesn't exist
      return res.status(200).json({
        success: true,
        message: "If your email is registered and not verified, you will receive a verification link."
      });
    }

    if (user.emailVerified) {
      return res.status(200).json({
        success: true,
        message: "Your email is already verified. You can log in now."
      });
    }

    // Generate new verification token
    const verificationToken = generateVerificationToken();

    // Update user with new verification token
    await prisma.user.update({
      where: { email },
      data: {
        verificationToken,
      },
    });

    // Send verification email
    try {
      await sendWelcomeEmail(email, user.firstName || 'User', verificationToken);
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      return res.status(500).json({
        success: false,
        message: "Failed to send verification email. Please try again later."
      });
    }

    res.status(200).json({
      success: true,
      message: "Verification email sent successfully. Please check your inbox."
    });
  } catch (error) {
    console.error("Error resending verification email:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while processing your request."
    });
  }
};

export const logout = (req: Request, res: Response) => {
  const isLocalhost = process.env.NODE_ENV !== 'production';

  const cookieOptions = {
    httpOnly: true,
    secure: !isLocalhost,
    sameSite: (isLocalhost ? 'lax' : 'none') as 'lax' | 'none',
    path: '/'
  };

  // Clear both access and refresh token cookies
  res.clearCookie('accessToken', cookieOptions);
  res.clearCookie('refreshToken', cookieOptions);

  res.status(200).json({ message: 'Logged out successfully' });
};
