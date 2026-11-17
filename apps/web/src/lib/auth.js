import CredentialsProvider from "next-auth/providers/credentials";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import {
  findUserByEmail,
  findUserByOAuthProvider,
  findCredentialUserByEmail,
  createOAuthUser,
} from "@/server/repositories/userRepository";

export const authOptions = {
  providers: [
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [
          GithubProvider({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          }),
        ]
      : []),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await findUserByEmail(credentials.email.trim().toLowerCase());
        if (!user || !user.password_hash) {
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!isValid) {
          return null;
        }

        return {
          id: String(user.id),
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },

  callbacks: {
    async signIn({ user, account }) {
      if (account.type === "credentials") {
        return true;
      }

      const provider = account.provider;
      const providerAccountId = account.providerAccountId;
      const email = user.email?.trim().toLowerCase();
      if (!email) return false;

      const byProvider = await findUserByOAuthProvider(provider, providerAccountId);
      if (byProvider) {
        user.id = String(byProvider.id);
        user.role = byProvider.role;
        return true;
      }

      const byEmail = await findCredentialUserByEmail(email);
      if (byEmail) {
        return "/login?error=OAuthEmailConflict";
      }

      const insertId = await createOAuthUser(email, provider, providerAccountId);
      user.id = String(insertId);
      user.role = "user";
      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
