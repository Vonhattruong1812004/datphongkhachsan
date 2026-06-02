import { z } from "zod";

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s.-]/g, "");
  if (compact.startsWith("+84")) return `0${compact.slice(3)}`;
  if (compact.startsWith("84")) return `0${compact.slice(2)}`;
  return compact;
}

export const loginSchema = z.object({
  username: z.string().trim().min(3, "Tên đăng nhập phải có ít nhất 3 ký tự."),
  password: z.string().min(1, "Vui lòng nhập mật khẩu.")
});

export const registerSchema = z.object({
  fullname: z.string()
    .transform(normalizeWhitespace)
    .pipe(
      z.string()
        .min(5, "Họ và tên phải có ít nhất 5 ký tự.")
        .max(80, "Họ và tên không được vượt quá 80 ký tự.")
        .regex(/^[\p{L}\s'.-]+$/u, "Họ và tên chỉ được gồm chữ cái, khoảng trắng và dấu hợp lệ.")
    )
    .refine((value) => value.split(" ").length >= 2, "Vui lòng nhập đầy đủ họ và tên."),
  username: z.string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(
      z.string()
        .regex(/^[a-z][a-z0-9_]{4,29}$/, "Tên đăng nhập phải dài 5-30 ký tự, bắt đầu bằng chữ và chỉ gồm chữ, số hoặc dấu gạch dưới.")
    ),
  password: z.string()
    .min(8, "Mật khẩu phải có ít nhất 8 ký tự.")
    .max(72, "Mật khẩu không được vượt quá 72 ký tự.")
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, "Mật khẩu phải có chữ hoa, chữ thường, số và ký tự đặc biệt."),
  repass: z.string().min(8, "Vui lòng nhập lại mật khẩu."),
  email: z.string()
    .trim()
    .toLowerCase()
    .email("Email không hợp lệ.")
    .max(100, "Email không được vượt quá 100 ký tự."),
  sdt: z.string()
    .transform(normalizePhone)
    .pipe(z.string().regex(/^0(3|5|7|8|9)\d{8}$/, "Số điện thoại phải là số Việt Nam hợp lệ, gồm 10 số và bắt đầu bằng 03, 05, 07, 08 hoặc 09.")),
  cccd: z.string()
    .transform((value) => value.trim().replace(/[\s.-]/g, ""))
    .pipe(z.string().regex(/^(\d{9}|\d{12})$/, "CCCD/CMND phải gồm đúng 9 hoặc 12 chữ số."))
}).superRefine((value, ctx) => {
  if (value.password !== value.repass) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Mật khẩu nhập lại không khớp.",
      path: ["repass"]
    });
  }
});
