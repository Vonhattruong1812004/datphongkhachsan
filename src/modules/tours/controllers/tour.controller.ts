import type { Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../../../shared/http/http-error";
import { TourService } from "../services/tour.service";

const tourService = new TourService();

export async function renderTourIndex(req: Request, res: Response) {
  const [payload, options, featuredTours] = await Promise.all([
    tourService.listPackages(req.query),
    tourService.getFilterOptions(),
    tourService.getFeaturedPackages(3)
  ]);

  return res.render("tours/index", {
    title: "Gói tour du lịch",
    tours: payload.packages,
    filters: payload.filters,
    options,
    featuredTours,
    successMessage: req.query.sent === "1" ? "Đã gửi yêu cầu tour. Nhân viên sẽ liên hệ để chốt lịch trình." : "",
    errorMessage: ""
  });
}

export async function renderTourDetail(req: Request, res: Response) {
  const tour = await tourService.getPackageBySlug(String(req.params.slug || ""));
  if (!tour) {
    throw new HttpError(404, "Gói tour không tồn tại hoặc đã ngừng bán.");
  }

  const relatedTours = (await tourService.getFeaturedPackages(4)).filter((item) => item.slug !== tour.slug).slice(0, 3);

  return res.render("tours/detail", {
    title: tour.name,
    tour,
    relatedTours,
    formValues: {
      hoten: req.session.user?.displayName || "",
      sdt: req.session.user?.phone || "",
      email: req.session.user?.email || "",
      ngaydi: "",
      songuoi: tour.minPeople,
      ghichu: ""
    },
    successMessage: req.query.sent === "1" ? "Đã gửi yêu cầu tour. Nhân viên sẽ liên hệ để xác nhận." : "",
    errorMessage: ""
  });
}

export async function createTourRequestAction(req: Request, res: Response) {
  const slug = String(req.params.slug || "");

  try {
    await tourService.createTourRequest(slug, req.body, req.session.user?.maKhachHang);
    return res.redirect(`/tours/${encodeURIComponent(slug)}?sent=1#tour-request`);
  } catch (error) {
    const tour = await tourService.getPackageBySlug(slug);
    if (!tour) {
      throw error;
    }

    const relatedTours = (await tourService.getFeaturedPackages(4)).filter((item) => item.slug !== tour.slug).slice(0, 3);
    const message = error instanceof ZodError
      ? error.issues[0]?.message || "Thông tin yêu cầu tour chưa hợp lệ."
      : error instanceof Error
        ? error.message
        : "Không gửi được yêu cầu tour.";

    return res.status(error instanceof HttpError ? error.statusCode : 422).render("tours/detail", {
      title: tour.name,
      tour,
      relatedTours,
      formValues: {
        hoten: String(req.body.hoten || ""),
        sdt: String(req.body.sdt || ""),
        email: String(req.body.email || ""),
        ngaydi: String(req.body.ngaydi || ""),
        songuoi: Number(req.body.songuoi || tour.minPeople),
        ghichu: String(req.body.ghichu || "")
      },
      successMessage: "",
      errorMessage: message
    });
  }
}
