export const ROLE = {
  ADMIN: 1,
  LE_TAN: 2,
  KE_TOAN: 3,
  DICH_VU: 4,
  CSKH: 5,
  QUAN_LY: 6,
  KHACH_HANG: 7
} as const;

export type RoleId = (typeof ROLE)[keyof typeof ROLE];

export const ROLE_LABELS: Record<number, string> = {
  [ROLE.ADMIN]: "Admin",
  [ROLE.LE_TAN]: "LeTan",
  [ROLE.KE_TOAN]: "KeToan",
  [ROLE.DICH_VU]: "DichVu",
  [ROLE.CSKH]: "CSKH",
  [ROLE.QUAN_LY]: "QuanLy",
  [ROLE.KHACH_HANG]: "KhachHang"
};

export const ROLE_REDIRECTS: Record<number, string> = {
  [ROLE.ADMIN]: "/dashboard/admin",
  [ROLE.LE_TAN]: "/dashboard/letan",
  [ROLE.KE_TOAN]: "/accounting",
  [ROLE.DICH_VU]: "/dashboard/dichvu",
  [ROLE.CSKH]: "/dashboard/cskh",
  [ROLE.QUAN_LY]: "/dashboard/quanly",
  [ROLE.KHACH_HANG]: "/customer/dashboard"
};
