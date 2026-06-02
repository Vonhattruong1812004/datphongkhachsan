from __future__ import annotations

import html
from pathlib import Path


SVG_OUT = Path("class_diagram_he_thong_dat_phong_UML_FINAL.svg")
W, H = 4200, 2400
BW, BH = 520, 240


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def t(x: int, y: int, value: str, *, size: int = 30, weight: int = 400, anchor: str = "start") -> str:
    return (
        f'<text x="{x}" y="{y}" font-family="Arial, Helvetica, sans-serif" '
        f'font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="#111">{esc(value)}</text>'
    )


def cls(name: str, attrs: list[str], methods: list[str], x: int, y: int) -> str:
    parts = [
        f'<rect x="{x}" y="{y}" width="{BW}" height="{BH}" rx="8" fill="#fff" stroke="#111" stroke-width="4"/>',
        f'<rect x="{x}" y="{y}" width="{BW}" height="60" rx="8" fill="#eeeeee" stroke="none"/>',
        f'<line x1="{x}" y1="{y+60}" x2="{x+BW}" y2="{y+60}" stroke="#111" stroke-width="3"/>',
        f'<line x1="{x}" y1="{y+165}" x2="{x+BW}" y2="{y+165}" stroke="#111" stroke-width="3"/>',
        t(x + BW // 2, y + 41, name, size=34, weight=800, anchor="middle"),
    ]
    yy = y + 94
    for attr in attrs[:3]:
        parts.append(t(x + 26, yy, attr, size=26))
        yy += 34
    yy = y + 199
    for method in methods[:1]:
        parts.append(t(x + 26, yy, method, size=25))
    return "\n".join(parts)


def side(pos: tuple[int, int], name: str) -> tuple[int, int]:
    x, y = pos
    if name == "L":
        return x, y + BH // 2
    if name == "R":
        return x + BW, y + BH // 2
    if name == "T":
        return x + BW // 2, y
    if name == "B":
        return x + BW // 2, y + BH
    raise ValueError(name)


def assoc(a: tuple[int, int], b: tuple[int, int], *, label: str = "", dashed: bool = False) -> str:
    dash = ' stroke-dasharray="14 12"' if dashed else ""
    parts = [f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}" stroke="#111" stroke-width="3"{dash}/>']
    if label:
        mx, my = (a[0] + b[0]) // 2, (a[1] + b[1]) // 2
        parts.append(f'<rect x="{mx-90}" y="{my-26}" width="180" height="34" rx="8" fill="#fff" stroke="#999" stroke-width="1"/>')
        parts.append(t(mx, my - 3, label, size=22, weight=800, anchor="middle"))
    return "\n".join(parts)


def poly(points: list[tuple[int, int]], *, label: str = "") -> str:
    data = " ".join(f"{x},{y}" for x, y in points)
    parts = [f'<polyline points="{data}" fill="none" stroke="#111" stroke-width="3"/>']
    if label:
        x, y = points[len(points) // 2]
        parts.append(f'<rect x="{x-90}" y="{y-26}" width="180" height="34" rx="8" fill="#fff" stroke="#999" stroke-width="1"/>')
        parts.append(t(x, y - 3, label, size=22, weight=800, anchor="middle"))
    return "\n".join(parts)


classes = {
    "VaiTro": ((90, 260), ["- maVaiTro: int", "- tenVaiTro: string", "- moTa: text"], ["+ capQuyen()"]),
    "TaiKhoan": ((760, 260), ["- maTK: int", "- username: string", "- trangThai: enum"], ["+ dangNhap()"]),
    "KhachHang": ((1430, 260), ["- maKhachHang: int", "- hoTen: string", "- trangThaiEkyc: enum"], ["+ datPhong()"]),
    "NhanVien": ((2100, 260), ["- maNhanVien: int", "- hoTen: string", "- chucVu: string"], ["+ xuLyNghiepVu()"]),
    "KhachSan": ((2770, 260), ["- maKhachSan: int", "- tenKhachSan: string", "- diaChi: string"], ["+ quanLyPhong()"]),
    "Phong": ((3440, 260), ["- maPhong: int", "- soPhong: string", "- trangThaiRT: enum"], ["+ capNhatTrangThai()"]),
    "KhuyenMai": ((90, 860), ["- maKhuyenMai: int", "- mucUuDai: decimal", "- trangThai: enum"], ["+ kiemTraHieuLuc()"]),
    "GiaoDich": ((760, 860), ["- maGiaoDich: int", "- tongTien: decimal", "- trangThai: enum"], ["+ xacNhanThanhToan()"]),
    "ChiTietGiaoDich": ((1430, 860), ["- maCTGD: int", "- ngayNhan: date", "- thanhTien: decimal"], ["+ checkInOut()"]),
    "HoaDon": ((2100, 860), ["- maHoaDon: int", "- tongTien: decimal", "- trangThai: enum"], ["+ lapHoaDon()"]),
    "DichVu": ((2770, 860), ["- maDichVu: int", "- tenDichVu: string", "- giaDichVu: decimal"], ["+ capNhatGia()"]),
    "ChiTietDichVu": ((3440, 860), ["- maCTDV: int", "- soLuong: int", "- thanhTien: decimal"], ["+ tinhTien()"]),
    "EkycVerification": ((90, 1460), ["- maEkyc: int", "- soGiayTo: string", "- ketQua: enum"], ["+ xacThuc()"]),
    "PhanHoi": ((760, 1460), ["- maPhanHoi: int", "- mucDoHaiLong: int", "- tinhTrang: enum"], ["+ guiPhanHoi()"]),
    "ChiTietPhanHoi": ((1430, 1460), ["- maCTPH: int", "- noiDungTraLoi: text", "- ngayTraLoi: date"], ["+ traLoi()"]),
    "RefundRequest": ((2100, 1460), ["- id: int", "- amountRequested: decimal", "- status: enum"], ["+ duyetHoanTien()"]),
    "CongNoPhaiThu": ((2770, 1460), ["- maCongNo: int", "- soTienGoc: decimal", "- trangThai: enum"], ["+ ghiNhanThu()"]),
    "RoomStatusLog": ((3440, 1460), ["- maLog: int", "- trangThaiMoi: string", "- thoiDiem: date"], ["+ ghiLog()"]),
}


relations = [
    ("VaiTro", "TaiKhoan", "R", "L", "1 - 0..*"),
    ("TaiKhoan", "KhachHang", "R", "L", "1 - 0..1"),
    ("TaiKhoan", "NhanVien", "R", "L", "1 - 0..1"),
    ("KhachSan", "Phong", "R", "L", "1 - 0..*"),
    ("KhachHang", "GiaoDich", "B", "T", "1 - 0..*"),
    ("NhanVien", "GiaoDich", "B", "T", "0..1 - 0..*"),
    ("KhuyenMai", "GiaoDich", "R", "L", "0..1 - 0..*"),
    ("GiaoDich", "ChiTietGiaoDich", "R", "L", "1 - 1..*"),
    ("ChiTietGiaoDich", "Phong", "R", "L", "0..* - 1"),
    ("GiaoDich", "HoaDon", "R", "L", "1 - 0..1"),
    ("GiaoDich", "RefundRequest", "B", "T", "1 - 0..*"),
    ("GiaoDich", "CongNoPhaiThu", "B", "T", "0..1 - 0..*"),
    ("DichVu", "ChiTietDichVu", "R", "L", "1 - 0..*"),
    ("Phong", "ChiTietDichVu", "B", "T", "0..1 - 0..*"),
    ("Phong", "RoomStatusLog", "B", "T", "1 - 0..*"),
    ("KhachHang", "EkycVerification", "B", "T", "1 - 0..*"),
    ("KhachHang", "PhanHoi", "B", "T", "1 - 0..*"),
    ("PhanHoi", "ChiTietPhanHoi", "R", "L", "1 - 0..*"),
    ("NhanVien", "ChiTietPhanHoi", "B", "T", "1 - 0..*"),
]


def main() -> None:
    out: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        '<rect width="100%" height="100%" fill="#fff"/>',
        t(W // 2, 86, "UML CLASS DIAGRAM", size=58, weight=900, anchor="middle"),
        t(W // 2, 134, "He thong dat phong khach san Bento Resort", size=34, weight=600, anchor="middle"),
        t(90, 205, "Ky hieu: moi class gom ten, thuoc tinh, phuong thuc; quan he the hien bang bo so 1, 0..1, 0..*.", size=29),
    ]

    for a, b, sa, sb, label in relations:
        pa = side(classes[a][0], sa)
        pb = side(classes[b][0], sb)
        if sa in ("L", "R") and sb in ("L", "R"):
            out.append(assoc(pa, pb, label=label))
        elif sa in ("T", "B") and sb in ("T", "B"):
            out.append(assoc(pa, pb, label=label))
        else:
            mid = (pa[0], pb[1])
            out.append(poly([pa, mid, pb], label=label))

    for name, (pos, attrs, methods) in classes.items():
        out.append(cls(name, attrs, methods, *pos))

    out.append("</svg>")
    SVG_OUT.write_text("\n".join(out), encoding="utf-8")
    print(SVG_OUT.resolve())


if __name__ == "__main__":
    main()
