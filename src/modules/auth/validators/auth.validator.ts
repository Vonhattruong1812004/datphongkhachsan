import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(3, "Tên đăng nhập phải có ít nhất 3 ký tự."),
  password: z.string().min(1, "Vui lòng nhập mật khẩu.")
});

export const registerSchema = z.object({
  fullname: z.string().min(2, "Họ tên phải có ít nhất 2 ký tự."),
  username: z.string().regex(/^[a-zA-Z0-9_]{5,20}$/, "Username chỉ gồm chữ, số hoặc dấu gạch dưới và dài từ 5-20 ký tự."),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự."),
  repass: z.string().min(6, "Vui lòng nhập lại mật khẩu."),
  email: z.string().email("Email không hợp lệ."),
  sdt: z.string().regex(/^(0|\+84)\d{8,10}$/, "Số điện thoại không hợp lệ."),
  cccd: z.string().regex(/^[0-9]{9,12}$/, "CCCD/CMND phải gồm 9-12 chữ số.")
}).superRefine((value, ctx) => {
  if (value.password !== value.repass) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Mật khẩu nhập lại không khớp.",
      path: ["repass"]
    });
  }
});
