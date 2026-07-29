import type { Request, Response } from "express";
import { HttpError } from "../../../shared/http/http-error";
import { NewsService } from "../services/news.service";

const service = new NewsService();

export async function renderNewsIndex(_req: Request, res: Response) {
  const articles = await service.listArticles();

  return res.render("news/index", {
    title: "Tin tức du lịch",
    articles,
    reactionLabels: service.reactionLabels
  });
}

export async function renderNewsDetail(req: Request, res: Response) {
  const article = await service.getArticle(String(req.params.slug || ""));
  if (!article) {
    throw new HttpError(404, "Tin tức không tồn tại hoặc đã được gỡ khỏi chuyên mục.");
  }

  const relatedArticles = (await service.listArticles()).filter((item) => item.slug !== article.slug).slice(0, 3);

  return res.render("news/detail", {
    title: article.title,
    article,
    relatedArticles,
    reactionLabels: service.reactionLabels
  });
}

export async function addNewsReactionAction(req: Request, res: Response) {
  const slug = String(req.params.slug || "");
  await service.addReaction(slug, String(req.body.reaction || ""));
  return res.redirect(`/news/${encodeURIComponent(slug)}#news-reactions`);
}

export async function addNewsCommentAction(req: Request, res: Response) {
  const slug = String(req.params.slug || "");
  const user = req.session.user;
  await service.addComment(slug, {
    author: user?.displayName || String(req.body.author || ""),
    message: String(req.body.message || "")
  });
  return res.redirect(`/news/${encodeURIComponent(slug)}#news-comments`);
}
