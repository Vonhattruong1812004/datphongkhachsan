import { Router } from "express";
import { asyncHandler } from "../../../shared/http/async-handler";
import {
  logout,
  renderLogin,
  renderRegister,
  submitLogin,
  submitRegister
} from "../controllers/auth.controller";

export const authRouter = Router();

authRouter.get("/login", asyncHandler(renderLogin));
authRouter.post("/login", asyncHandler(submitLogin));
authRouter.get("/register", asyncHandler(renderRegister));
authRouter.post("/register", asyncHandler(submitRegister));
authRouter.post("/logout", asyncHandler(logout));
