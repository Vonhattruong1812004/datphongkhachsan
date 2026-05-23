import { Router } from "express";
import { requireRole } from "../../../shared/auth/guards";
import { asyncHandler } from "../../../shared/http/async-handler";
import { ROLE } from "../../../shared/constants/roles";
import {
  bookingFeedbackApi,
  createBookingApi,
  createMultiRoomBookingApi,
  customerBookingHoldStatusApi,
  lookupBookingApi,
  previewBookingApi,
  recommendationBookingApi,
  renderBookingFormPage,
  renderInvoicePage,
  renderMultiRoomBookingPage,
  renderRoomDetailPage,
  renderSearchPage,
  submitBookingForm,
  submitMultiRoomBooking,
  searchRoomsApi
} from "../controllers/booking.controller";

export const bookingRouter = Router();
export const bookingApiRouter = Router();

bookingRouter.get("/search", asyncHandler(renderSearchPage));
bookingRouter.get("/multi", asyncHandler(renderMultiRoomBookingPage));
bookingRouter.post("/multi", asyncHandler(submitMultiRoomBooking));
bookingRouter.get("/rooms/:roomId/detail", asyncHandler(renderRoomDetailPage));
bookingRouter.get("/rooms/:roomId", asyncHandler(renderBookingFormPage));
bookingRouter.post("/rooms/:roomId", asyncHandler(submitBookingForm));
bookingRouter.get("/invoice/:id", asyncHandler(renderInvoicePage));
bookingApiRouter.get("/search", asyncHandler(searchRoomsApi));
bookingApiRouter.get("/recommendations", asyncHandler(recommendationBookingApi));
bookingApiRouter.post("/preview", asyncHandler(previewBookingApi));
bookingApiRouter.post("/create", asyncHandler(createBookingApi));
bookingApiRouter.post("/create-multi", asyncHandler(createMultiRoomBookingApi));
bookingApiRouter.get("/holds/:holdId", asyncHandler(customerBookingHoldStatusApi));
bookingApiRouter.get("/lookup", asyncHandler(lookupBookingApi));
bookingApiRouter.post("/feedback", requireRole([ROLE.KHACH_HANG]), asyncHandler(bookingFeedbackApi));
