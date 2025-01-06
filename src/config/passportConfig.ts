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
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user already exists
        const user = await prisma.user.findUnique({
          where: { email: profile.emails?.[0].value },
        });

        if (user) {
          return done(null, user); // Existing user
        }

        // Create a new user
        const newUser = await prisma.user.create({
          data: {
            email: profile.emails?.[0]?.value || "no-reply@example.com", // Fallback to a default email if not provided
            password: "", // Provide a placeholder password or handle differently for Google sign-ins
            role: "USER", // Assign a default role or customize as needed
          },
        });

        return done(null, newUser);
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
