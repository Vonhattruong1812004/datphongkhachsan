import { Router } from "express";
import { requireRole } from "../../../shared/auth/guards";
import { asyncHandler } from "../../../shared/http/async-handler";
import { ROLE } from "../../../shared/constants/roles";
import {
  cancelBookingApi,
  checkInRoomApi,
  checkoutPaymentStatusApi,
  checkoutPreviewApi,
  checkoutRoomApi,
  createDirectBookingApi,
  directBookingHoldStatusApi,
  directBookingSearchApi,
  lookupDirectBookingCustomersApi,
  lookupTransactionApi,
  renderActivityLookupPage,
  renderCancelBookingPage,
  renderCheckinPage,
  renderCheckoutPage,
  renderDirectBookingPage,
  renderEditBookingPage,
  renderFrontdeskPage,
  submitCancelBookingPage,
  submitCheckinPage,
  submitCheckoutPage,
  submitDirectBookingPage,
  submitEditBookingPage,
  updateBookedRoomApi
} from "../controllers/frontdesk.controller";

export const frontdeskRouter = Router();
export const frontdeskApiRouter = Router();

frontdeskRouter.get("/", requireRole([ROLE.LE_TAN]), (_req, res) => res.redirect("/dashboard/letan"));
frontdeskRouter.get("/activity-lookup", requireRole([ROLE.LE_TAN]), asyncHandler(renderActivityLookupPage));
frontdeskRouter.get("/direct-booking", requireRole([ROLE.LE_TAN]), asyncHandler(renderDirectBookingPage));
frontdeskRouter.post("/direct-booking", requireRole([ROLE.LE_TAN]), asyncHandler(submitDirectBookingPage));
frontdeskRouter.get("/checkin", requireRole([ROLE.LE_TAN]), asyncHandler(renderCheckinPage));
frontdeskRouter.post("/checkin", requireRole([ROLE.LE_TAN]), asyncHandler(submitCheckinPage));
frontdeskRouter.get("/checkout-v2", requireRole([ROLE.LE_TAN]), asyncHandler(renderCheckoutPage));
frontdeskRouter.post("/checkout-v2", requireRole([ROLE.LE_TAN]), asyncHandler(submitCheckoutPage));
frontdeskRouter.get("/edit-booking", requireRole([ROLE.LE_TAN]), asyncHandler(renderEditBookingPage));
frontdeskRouter.post("/edit-booking", requireRole([ROLE.LE_TAN]), asyncHandler(submitEditBookingPage));
frontdeskRouter.get("/cancel-booking", requireRole([ROLE.LE_TAN]), asyncHandler(renderCancelBookingPage));
frontdeskRouter.post("/cancel-booking", requireRole([ROLE.LE_TAN]), asyncHandler(submitCancelBookingPage));

frontdeskApiRouter.get("/lookup", requireRole([ROLE.LE_TAN]), asyncHandler(lookupTransactionApi));
frontdeskApiRouter.get("/direct-booking/customers", requireRole([ROLE.LE_TAN]), asyncHandler(lookupDirectBookingCustomersApi));
frontdeskApiRouter.get("/direct-search", requireRole([ROLE.LE_TAN]), asyncHandler(directBookingSearchApi));
frontdeskApiRouter.get("/direct-booking/holds/:holdId", requireRole([ROLE.LE_TAN]), asyncHandler(directBookingHoldStatusApi));
frontdeskApiRouter.post("/direct-booking", requireRole([ROLE.LE_TAN]), asyncHandler(createDirectBookingApi));
frontdeskApiRouter.post("/checkin", requireRole([ROLE.LE_TAN]), asyncHandler(checkInRoomApi));
frontdeskApiRouter.get("/checkout-preview", requireRole([ROLE.LE_TAN]), asyncHandler(checkoutPreviewApi));
frontdeskApiRouter.get("/checkout-payment/status", requireRole([ROLE.LE_TAN]), asyncHandler(checkoutPaymentStatusApi));
frontdeskApiRouter.post("/checkout", requireRole([ROLE.LE_TAN]), asyncHandler(checkoutRoomApi));
frontdeskApiRouter.post("/cancel", requireRole([ROLE.LE_TAN]), asyncHandler(cancelBookingApi));
frontdeskApiRouter.post("/update-room", requireRole([ROLE.LE_TAN]), asyncHandler(updateBookedRoomApi));
