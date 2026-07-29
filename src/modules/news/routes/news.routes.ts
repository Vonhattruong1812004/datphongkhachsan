import { Router } from "express";
import { asyncHandler } from "../../../shared/http/async-handler";
import {
  addNewsCommentAction,
  addNewsReactionAction,
  renderNewsDetail,
  renderNewsIndex
} from "../controllers/news.controller";

export const newsRouter = Router();

newsRouter.get("/", asyncHandler(renderNewsIndex));
newsRouter.get("/:slug", asyncHandler(renderNewsDetail));
newsRouter.post("/:slug/reactions", asyncHandler(addNewsReactionAction));
newsRouter.post("/:slug/comments", asyncHandler(addNewsCommentAction));
