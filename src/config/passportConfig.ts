import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { prisma } from "../models/prismaClient";
import { loginUser } from "../controllers/authController";
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      callbackURL: `${process.env.BASE_URL}/auth/google-callback`,
      scope: [
      'https://www.googleapis.com/auth/drive',
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/spreadsheets"
      ],
      passReqToCallback: true, 
    },
    async (req:any,accessToken:any, refreshToken:any, params:any, profile:any, done:any) => {
      try {
        req.authInfo = { accessToken, refreshToken };
        const expiresIn = params.expires_in; // Token lifespan in seconds
        const expirationTimestamp = Math.floor(Date.now() / 1000) + expiresIn;
        let user = await prisma.user.findUnique({
          where: { email: profile.emails?.[0].value },
        });

        if (user) {
          // Update existing user with new tokens and mark email as verified (Google emails are pre-verified)
          user = await prisma.user.update({
            where: {
              email: profile.emails?.[0]?.value, // Specify the user to update based on their email
            },
            data:{
              email: profile.emails?.[0]?.value,
              accessToken: accessToken,
              refreshToken: refreshToken || user.refreshToken,
              accessTokenExpiresAt: expirationTimestamp,
              emailVerified: true, // Google emails are pre-verified
              verificationToken: null, // Clear any existing verification token
            },
            })
        } else {
          // Create free payment and package subscription in a single transaction
          const startDate = new Date();
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 7);

          const result = await prisma.$transaction(async (tx) => {
            // 1. Create user
            const newUser = await tx.user.create({
              data: {
                email: profile.emails?.[0]?.value || "no-reply@example.com",
                password: "", // No password needed for Google sign-in
                role: "USER",
                accessToken,
                refreshToken,
                accessTokenExpiresAt: expirationTimestamp,
                emailVerified: true, // Google emails are pre-verified
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

          user = result.newUser;
        }

        return done(null, user);
      } catch (error) {
        return done(error, loginUser);
      }
    }
  )
);

// Serialize user for session (if using session-based authentication)
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: number, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});
