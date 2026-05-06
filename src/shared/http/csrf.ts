import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./http-error";

const CSRF_FIELD = "_csrf";
const CSRF_HEADER = "x-csrf-token";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/api/webhook/sepay") {
    return next();
  }

  if (req.path.startsWith("/api/") && !UNSAFE_METHODS.has(req.method)) {
    return next();
  }

  const token = ensureCsrfToken(req);

  res.locals.csrfToken = token;
  res.locals.csrfField = `<input type="hidden" name="${CSRF_FIELD}" value="${escapeHtml(token)}">`;
  patchRenderForCsrf(res, next);

  if (!UNSAFE_METHODS.has(req.method)) {
    return next();
  }

  if (String(req.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) {
    return next();
  }

  const submittedToken = readSubmittedToken(req);
  if (!isTokenMatch(token, submittedToken)) {
    throw new HttpError(403, "Phiên bảo mật đã hết hạn hoặc form không hợp lệ. Vui lòng tải lại trang và thử lại.");
  }

  return next();
}

export function validateCsrfToken(req: Request, _res: Response, next: NextFunction) {
  const token = req.session.csrfToken || "";
  const submittedToken = readSubmittedToken(req);

  if (!isTokenMatch(token, submittedToken)) {
    throw new HttpError(403, "Phiên bảo mật đã hết hạn hoặc form không hợp lệ. Vui lòng tải lại trang và thử lại.");
  }

  return next();
}

function ensureCsrfToken(req: Request) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  }

  return req.session.csrfToken;
}

function readSubmittedToken(req: Request) {
  const headerToken = req.get(CSRF_HEADER);
  if (headerToken) {
    return headerToken;
  }

  const body = req.body as Record<string, unknown> | undefined;
  const bodyToken = body?.[CSRF_FIELD];
  if (Array.isArray(bodyToken)) {
    return String(bodyToken[0] || "");
  }

  return typeof bodyToken === "string" ? bodyToken : "";
}

function isTokenMatch(expected: string, actual: string) {
  if (!expected || !actual) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function patchRenderForCsrf(res: Response, next: NextFunction) {
  if ((res.locals as Record<string, unknown>).__csrfRenderPatched) {
    return;
  }

  const originalRender = res.render.bind(res) as any;
  res.render = ((view: string, options?: object | ((err: Error, html: string) => void), callback?: (err: Error, html: string) => void) => {
    const inject = (html: string) => injectCsrfIntoForms(html, res.locals.csrfToken);

    if (typeof options === "function") {
      return originalRender(view, (err: Error, html: string) => {
        options(err, err ? html : inject(html));
      });
    }

    if (callback) {
      return originalRender(view, options, (err: Error, html: string) => {
        callback(err, err ? html : inject(html));
      });
    }

    return originalRender(view, options, (err: Error, html: string) => {
      if (err) {
        return next(err);
      }

      return res.send(inject(html));
    });
  }) as Response["render"];

  (res.locals as Record<string, unknown>).__csrfRenderPatched = true;
}

function injectCsrfIntoForms(html: string, token: string) {
  if (!token || !/<form\b/i.test(html)) {
    return html;
  }

  const field = `<input type="hidden" name="${CSRF_FIELD}" value="${escapeHtml(token)}">`;
  return html.replace(/<form\b([^>]*)>/gi, (match, attrs: string) => {
    const normalizedAttrs = String(attrs || "");
    if (!/\bmethod\s*=\s*["']?post["']?/i.test(normalizedAttrs) || /\bname\s*=\s*["']?_csrf["']?/i.test(normalizedAttrs)) {
      return match;
    }

    return `${match}${field}`;
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
