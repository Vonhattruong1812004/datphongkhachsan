import { Router } from "express";
import { requireRole } from "../../../shared/auth/guards";
import { asyncHandler } from "../../../shared/http/async-handler";
import { ROLE } from "../../../shared/constants/roles";
import {
  cancelCustomerBookingAction,
  cancelCustomerBookingApi,
  cancelCustomerServiceOrderAction,
  cancelCustomerServiceOrderApi,
  createCustomerServiceOrderAction,
  createCustomerServiceOrderApi,
  customerMobileApi,
  customerServicePortalApi,
  renderCustomerAdvisory,
  renderCustomerBookingEdit,
  renderCustomerBookingDetail,
  renderCustomerBookings,
  renderCustomerDashboard,
  renderCustomerMobileHub,
  renderCustomerProfile,
  renderCustomerServices,
  updateCustomerProfileAction,
  updateCustomerBookingAction,
  updateCustomerBookingApi,
  updateCustomerProfileApi
} from "../controllers/customer.controller";

export const customerRouter = Router();
export const customerApiRouter = Router();

customerRouter.get("/dashboard", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderCustomerDashboard));
customerRouter.get("/mobile-hub", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderCustomerMobileHub));
customerRouter.get("/profile", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderCustomerProfile));
customerRouter.post("/profile", requireRole([ROLE.KHACH_HANG]), asyncHandler(updateCustomerProfileAction));
customerRouter.get("/advisory", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderCustomerAdvisory));
customerRouter.get("/services", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderCustomerServices));
customerRouter.post("/services", requireRole([ROLE.KHACH_HANG]), asyncHandler(createCustomerServiceOrderAction));
customerRouter.post("/service-orders/:id/cancel", requireRole([ROLE.KHACH_HANG]), asyncHandler(cancelCustomerServiceOrderAction));
customerRouter.get("/bookings", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderCustomerBookings));
customerRouter.get("/bookings/:id/edit", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderCustomerBookingEdit));
customerRouter.post("/bookings/:id/edit", requireRole([ROLE.KHACH_HANG]), asyncHandler(updateCustomerBookingAction));
customerRouter.get("/bookings/:id", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderCustomerBookingDetail));
customerRouter.post("/bookings/:id/cancel", requireRole([ROLE.KHACH_HANG]), asyncHandler(cancelCustomerBookingAction));

customerApiRouter.get("/mobile-home", requireRole([ROLE.KHACH_HANG]), asyncHandler(customerMobileApi));
customerApiRouter.get("/services", requireRole([ROLE.KHACH_HANG]), asyncHandler(customerServicePortalApi));
customerApiRouter.post("/services", requireRole([ROLE.KHACH_HANG]), asyncHandler(createCustomerServiceOrderApi));
customerApiRouter.post("/service-orders/:id/cancel", requireRole([ROLE.KHACH_HANG]), asyncHandler(cancelCustomerServiceOrderApi));
customerApiRouter.post("/profile", requireRole([ROLE.KHACH_HANG]), asyncHandler(updateCustomerProfileApi));
customerApiRouter.post("/bookings/:id/edit", requireRole([ROLE.KHACH_HANG]), asyncHandler(updateCustomerBookingApi));
customerApiRouter.post("/bookings/:id/cancel", requireRole([ROLE.KHACH_HANG]), asyncHandler(cancelCustomerBookingApi));
