import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import jwt from "jsonwebtoken";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => callback(null, origin || true),
    credentials: true,
  }),
);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set.");
}

const isDev = process.env.NODE_ENV === "development";

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: !isDev, // false for localhost, true for production HTTPS
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: isDev ? "lax" : "none",
      domain: isDev ? "localhost" : undefined,
    },
  }),
);

// JWT middleware: read auth_token cookie OR Authorization: Bearer header
const JWT_SECRET = process.env.JWT_SECRET || "your-app-id-or-realm-identifier";
app.use((req: Request, _res: Response, next: NextFunction) => {
  const cookieToken = req.cookies?.auth_token as string | undefined;
  const authHeader = req.headers.authorization;
  const bearerToken =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined;
  const token = cookieToken ?? bearerToken;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
      (req as Record<string, unknown>).user = payload;
    } catch {
      // Invalid/expired token — leave req.user undefined; route handlers will 401
    }
  }
  next();
});

app.use("/api", router);

export default app;
