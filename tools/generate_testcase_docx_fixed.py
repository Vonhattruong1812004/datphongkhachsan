from __future__ import annotations

import html
import zipfile
from pathlib import Path


OUT = Path("Testcase_he_thong_dat_phong.docx")


# A4 portrait-friendly width so the table can be pasted into the report
# without being cut off horizontally.
COL_WIDTHS = [650, 1150, 1250, 1400, 1500, 1350, 1350, 710]
TABLE_WIDTH = sum(COL_WIDTHS)


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def run(text: str, *, bold: bool = False, size: int = 16, color: str = "000000") -> str:
    props = [f'<w:sz w:val="{size}"/>', f'<w:szCs w:val="{size}"/>', f'<w:color w:val="{color}"/>']
    if bold:
        props.insert(0, "<w:b/>")
    return f"<w:r><w:rPr>{''.join(props)}</w:rPr><w:t xml:space=\"preserve\">{esc(text)}</w:t></w:r>"


def paragraph(text: str = "", *, style: str | None = None, bold: bool = False, size: int = 22,
              color: str = "000000", align: str | None = None, keep_next: bool = False) -> str:
    ppr = []
    if style:
        ppr.append(f'<w:pStyle w:val="{style}"/>')
    if align:
        ppr.append(f'<w:jc w:val="{align}"/>')
    if keep_next:
        ppr.append("<w:keepNext/>")
    ppr_xml = f"<w:pPr>{''.join(ppr)}</w:pPr>" if ppr else ""
    return f"<w:p>{ppr_xml}{run(text, bold=bold, size=size, color=color)}</w:p>"


def cell(text: str, width: int, *, header: bool = False, center: bool = False, bold: bool = False) -> str:
    fill = '<w:shd w:fill="BDD7EE"/>' if header else ""
    valign = '<w:vAlign w:val="center"/>'
    margins = (
        '<w:tcMar>'
        '<w:top w:w="90" w:type="dxa"/>'
        '<w:left w:w="80" w:type="dxa"/>'
        '<w:bottom w:w="90" w:type="dxa"/>'
        '<w:right w:w="80" w:type="dxa"/>'
        '</w:tcMar>'
    )
    tcpr = f'<w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{fill}{valign}{margins}</w:tcPr>'
    align = "center" if center or header else "left"
    size = 16 if not header else 17
    parts = [line.strip() for line in str(text).split("\n") if line.strip()]
    if not parts:
        parts = [""]
    paras = []
    for line in parts:
        paras.append(paragraph(line, bold=header or bold, size=size, align=align))
    return f"<w:tc>{tcpr}{''.join(paras)}</w:tc>"


def row(values: list[str], *, header: bool = False) -> str:
    cells = []
    for idx, value in enumerate(values):
        center = idx in (0, 7)
        cells.append(cell(value, COL_WIDTHS[idx], header=header, center=center, bold=idx in (0, 7)))
    trpr = "<w:trPr><w:tblHeader/></w:trPr>" if header else ""
    return f"<w:tr>{trpr}{''.join(cells)}</w:tr>"


def table(rows: list[dict[str, str]]) -> str:
    headers = [
        "Test\nID",
        "Chức năng",
        "Điều kiện\ntrước",
        "Mô tả",
        "Dữ liệu Test",
        "Kết quả\nmong muốn",
        "Kết quả\nthực tế",
        "Pass/\nFail",
    ]
    tbl_pr = (
        '<w:tblPr>'
        '<w:tblStyle w:val="TableGrid"/>'
        f'<w:tblW w:w="{TABLE_WIDTH}" w:type="dxa"/>'
        '<w:tblLayout w:type="fixed"/>'
        '<w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
        '</w:tblPr>'
    )
    grid = "<w:tblGrid>" + "".join(f'<w:gridCol w:w="{w}"/>' for w in COL_WIDTHS) + "</w:tblGrid>"
    body = [row(headers, header=True)]
    for item in rows:
        body.append(row([
            item["id"],
            item["function"],
            item["pre"],
            item["desc"],
            item["data"],
            item["expected"],
            item["actual"],
            "Pass",
        ]))
    return f"<w:tbl>{tbl_pr}{grid}{''.join(body)}</w:tbl>"


def testcase(id_: str, function: str, pre: str, desc: str, data: str, expected: str, actual: str) -> dict[str, str]:
    return {
        "id": id_,
        "function": function,
        "pre": pre,
        "desc": desc,
        "data": data,
        "expected": expected,
        "actual": actual,
    }


SECTIONS = [
    ("1. Testcase chung", [
        testcase("TC_CHUNG_01", "Đăng nhập đúng vai trò", "Tài khoản đã tồn tại và đang hoạt động.", "Kiểm tra đăng nhập thành công với tài khoản hợp lệ.", "Username: letan1\nPassword: 123456", "Đăng nhập thành công và chuyển đến dashboard đúng vai trò.", "Hệ thống đăng nhập thành công và chuyển đến dashboard lễ tân."),
        testcase("TC_CHUNG_02", "Đăng nhập sai mật khẩu", "Tài khoản đã tồn tại.", "Kiểm tra xử lý khi nhập sai mật khẩu.", "Username: letan1\nPassword: sai_mat_khau", "Hệ thống từ chối đăng nhập và hiển thị thông báo lỗi.", "Hệ thống hiển thị thông báo sai tên đăng nhập hoặc mật khẩu."),
        testcase("TC_CHUNG_03", "Đăng ký khách hàng", "Người dùng ở trang đăng ký.", "Kiểm tra tạo tài khoản khách hàng mới.", "Họ tên, SĐT, email, CCCD, username, password hợp lệ.", "Tạo khách hàng và tài khoản mới.", "Hệ thống tạo khách hàng, mã hóa mật khẩu và chuyển về đăng nhập."),
        testcase("TC_CHUNG_04", "Đăng ký trùng dữ liệu", "Email/SĐT/CCCD đã tồn tại.", "Kiểm tra chặn đăng ký khi trùng dữ liệu cũ.", "Email hoặc SĐT hoặc CCCD đã có trong CSDL.", "Hệ thống không tạo tài khoản mới.", "Hệ thống báo thông tin đã được sử dụng."),
        testcase("TC_CHUNG_05", "Đăng xuất", "Người dùng đã đăng nhập.", "Kiểm tra chức năng thoát khỏi hệ thống.", "Nhấn nút Đăng xuất.", "Phiên đăng nhập bị hủy và chuyển về trang đăng nhập.", "Hệ thống đăng xuất thành công."),
        testcase("TC_CHUNG_06", "Phân quyền truy cập", "Người dùng đăng nhập bằng vai trò khách hàng.", "Kiểm tra chặn màn hình trái vai trò.", "Truy cập /admin/users.", "Hệ thống không cho truy cập.", "Hệ thống từ chối quyền truy cập."),
    ]),
    ("2. Testcase actor Lễ tân", [
        testcase("TC_LT_01", "Đặt phòng tại quầy", "Lễ tân đã đăng nhập.", "Tạo booking trực tiếp cho khách tại quầy.", "Ngày đến 29/05/2026, số khách 2, phòng còn trống.", "Booking được tạo và sinh QR cọc.", "Hệ thống tạo booking, giữ phòng và hiển thị QR cọc."),
        testcase("TC_LT_02", "Tìm phòng phù hợp", "Có dữ liệu phòng trong hệ thống.", "Tìm phòng theo ngày ở và số khách.", "Ngày đến, ngày đi, số khách.", "Danh sách phòng phù hợp được hiển thị.", "Hệ thống trả về danh sách phòng đúng điều kiện."),
        testcase("TC_LT_03", "Check-in booking", "Booking ở trạng thái đã đặt.", "Xác nhận khách đến nhận phòng.", "Mã giao dịch hoặc CCCD khách.", "Booking chuyển sang đang ở.", "Hệ thống cập nhật trạng thái check-in thành công."),
        testcase("TC_LT_04", "Check-out booking", "Booking đang ở.", "Hoàn tất trả phòng và tính tiền.", "Mã booking, dịch vụ phát sinh.", "Tạo tổng tiền và chuyển sang checkout.", "Hệ thống tính tiền phòng, dịch vụ và hoàn tất checkout."),
        testcase("TC_LT_05", "Sửa booking", "Booking trước thời điểm check-in.", "Cập nhật thông tin đặt phòng.", "Ngày ở, phòng, ghi chú mới.", "Thông tin booking được cập nhật.", "Hệ thống lưu thay đổi và ghi nhận lịch sử."),
        testcase("TC_LT_06", "Hủy booking", "Booking còn được phép hủy.", "Hủy đặt phòng theo yêu cầu.", "Mã booking cần hủy.", "Booking chuyển trạng thái hủy.", "Hệ thống hủy booking và giải phóng phòng."),
    ]),
    ("3. Testcase actor Khách hàng", [
        testcase("TC_KH_01", "Tìm phòng online", "Khách ở trang đặt phòng.", "Tìm phòng theo ngày, địa điểm và số khách.", "Ho Chi Minh, 2 khách, 2 đêm.", "Phòng phù hợp được hiển thị.", "Hệ thống hiển thị phòng đúng điều kiện tìm kiếm."),
        testcase("TC_KH_02", "Đặt phòng online", "Khách đã chọn phòng.", "Tạo booking online từ website.", "Thông tin khách, phòng, ngày ở.", "Booking được tạo ở trạng thái chờ cọc.", "Hệ thống tạo booking thành công."),
        testcase("TC_KH_03", "Quản lý đặt phòng", "Khách đã đăng nhập.", "Xem danh sách booking của tài khoản.", "Tài khoản khách hợp lệ.", "Danh sách booking của khách được hiển thị.", "Hệ thống hiển thị đúng booking theo khách."),
        testcase("TC_KH_04", "Gửi eKYC", "Khách đã có tài khoản.", "Gửi hồ sơ xác minh định danh.", "Ảnh giấy tờ và thông tin cá nhân.", "Hồ sơ eKYC được lưu chờ duyệt.", "Hệ thống lưu hồ sơ và chuyển trạng thái chờ duyệt."),
        testcase("TC_KH_05", "Gửi tư vấn", "Khách ở màn hình tư vấn.", "Gửi câu hỏi cho CSKH.", "Nội dung cần tư vấn.", "Yêu cầu tư vấn được tạo.", "Hệ thống ghi nhận tư vấn vào inbox CSKH."),
        testcase("TC_KH_06", "Gửi phản hồi", "Khách đã sử dụng dịch vụ.", "Gửi đánh giá sau lưu trú.", "Điểm đánh giá, nội dung phản hồi.", "Phản hồi được lưu.", "Hệ thống lưu phản hồi và hiển thị trong CSKH."),
    ]),
    ("4. Testcase actor Quản lý", [
        testcase("TC_QL_01", "Quản lý khách hàng", "Quản lý đã đăng nhập.", "Tìm kiếm và xem hồ sơ khách hàng.", "Tên, SĐT, CCCD.", "Thông tin khách được hiển thị.", "Hệ thống lọc và hiển thị đúng khách hàng."),
        testcase("TC_QL_02", "Quản lý phòng", "Có danh sách phòng.", "Cập nhật thông tin phòng.", "Loại phòng, sức chứa, giá.", "Thông tin phòng được lưu.", "Hệ thống cập nhật phòng thành công."),
        testcase("TC_QL_03", "Quản lý khuyến mãi", "Quản lý đã đăng nhập.", "Tạo hoặc cập nhật mã khuyến mãi.", "Mã, phần trăm giảm, thời hạn.", "Khuyến mãi được lưu.", "Hệ thống lưu khuyến mãi và áp dụng khi hợp lệ."),
        testcase("TC_QL_04", "Duyệt hoàn tiền", "Có yêu cầu hoàn tiền.", "Xem và xử lý yêu cầu hoàn tiền.", "Mã booking, lý do hoàn.", "Yêu cầu được cập nhật trạng thái.", "Hệ thống cập nhật trạng thái hoàn tiền."),
        testcase("TC_QL_05", "Xem audit", "Có log hệ thống.", "Theo dõi lịch sử thao tác.", "Bộ lọc thời gian, actor.", "Log thao tác được hiển thị.", "Hệ thống hiển thị log đúng bộ lọc."),
        testcase("TC_QL_06", "Kiểm tra eKYC", "Có hồ sơ eKYC chờ duyệt.", "Xem và duyệt hồ sơ định danh.", "Mã khách hàng.", "Trạng thái eKYC được cập nhật.", "Hệ thống duyệt eKYC thành công."),
    ]),
    ("5. Testcase actor Kế toán", [
        testcase("TC_KT_01", "Quản lý doanh thu", "Kế toán đã đăng nhập.", "Xem doanh thu theo kỳ.", "Tháng 05/2026.", "Doanh thu được tổng hợp.", "Hệ thống hiển thị doanh thu đúng kỳ."),
        testcase("TC_KT_02", "Quản lý chi phí", "Có dữ liệu phiếu chi.", "Tạo hoặc lọc chi phí.", "Tên chi phí, số tiền, ngày chi.", "Chi phí được lưu và hiển thị.", "Hệ thống lưu phiếu chi thành công."),
        testcase("TC_KT_03", "Công nợ phải thu", "Có booking còn công nợ.", "Xem danh sách công nợ.", "Bộ lọc quá hạn.", "Danh sách công nợ hiển thị.", "Hệ thống hiển thị đúng khoản cần thu."),
        testcase("TC_KT_04", "Xử lý hoàn tiền", "Có yêu cầu hoàn tiền đã duyệt.", "Kế toán xác nhận chi hoàn tiền.", "Mã yêu cầu, tham chiếu thanh toán.", "Yêu cầu chuyển sang đã chi.", "Hệ thống cập nhật hoàn tiền thành công."),
        testcase("TC_KT_05", "Báo cáo tài chính", "Có dữ liệu thu chi.", "Xuất báo cáo theo kỳ.", "Khoảng thời gian báo cáo.", "Báo cáo tổng hợp được hiển thị.", "Hệ thống tạo báo cáo đúng dữ liệu."),
        testcase("TC_KT_06", "Đối soát SePay", "Có giao dịch thanh toán.", "Kiểm tra thanh toán qua webhook.", "Mã giao dịch SePay.", "Giao dịch được ghi nhận đã thanh toán.", "Hệ thống cập nhật trạng thái thanh toán thành công."),
    ]),
    ("6. Testcase actor Nhân viên dịch vụ", [
        testcase("TC_DV_01", "Quản lý dịch vụ", "Nhân viên dịch vụ đã đăng nhập.", "Thêm hoặc cập nhật dịch vụ.", "Tên dịch vụ, giá, mô tả.", "Dịch vụ được lưu.", "Hệ thống cập nhật danh mục dịch vụ thành công."),
        testcase("TC_DV_02", "Kiểm tra phòng", "Có danh sách phòng cần theo dõi.", "Cập nhật tình trạng phòng sau kiểm tra.", "Mã phòng, tình trạng, ghi chú.", "Tình trạng phòng được cập nhật.", "Hệ thống lưu log kiểm tra và đồng bộ room board."),
        testcase("TC_DV_03", "Room board live", "Có dữ liệu phòng realtime.", "Theo dõi trạng thái phòng.", "Mở room board.", "Danh sách phòng hiển thị realtime.", "Hệ thống hiển thị đúng trạng thái phòng."),
        testcase("TC_DV_04", "Gán dịch vụ vào phòng", "Booking đang ở.", "Thêm dịch vụ phát sinh cho phòng.", "Mã phòng, dịch vụ, số lượng.", "Dịch vụ được tính vào booking.", "Hệ thống lưu dịch vụ phát sinh thành công."),
        testcase("TC_DV_05", "Lọc dịch vụ", "Có danh mục dịch vụ.", "Tìm kiếm dịch vụ theo tên.", "Từ khóa dịch vụ.", "Dịch vụ phù hợp được hiển thị.", "Hệ thống lọc đúng danh sách dịch vụ."),
        testcase("TC_DV_06", "Kiểm tra bảo trì", "Phòng cần bảo trì.", "Cập nhật trạng thái bảo trì.", "Mã phòng, ghi chú bảo trì.", "Phòng chuyển trạng thái bảo trì.", "Hệ thống cập nhật trạng thái phòng thành công."),
    ]),
    ("7. Testcase actor CSKH", [
        testcase("TC_CSKH_01", "Quản lý phản hồi", "Có phản hồi khách hàng.", "Lọc và xem chi tiết phản hồi.", "Trạng thái, điểm đánh giá.", "Danh sách phản hồi hiển thị.", "Hệ thống hiển thị đúng phản hồi theo bộ lọc."),
        testcase("TC_CSKH_02", "Trả lời phản hồi", "Phản hồi đang mở.", "Gửi nội dung phản hồi cho khách.", "Nội dung trả lời.", "Phản hồi được cập nhật.", "Hệ thống lưu trả lời và cập nhật trạng thái."),
        testcase("TC_CSKH_03", "Trả lời tư vấn", "Có câu hỏi tư vấn.", "CSKH trả lời câu hỏi của khách.", "Nội dung tư vấn.", "Câu trả lời được lưu.", "Hệ thống lưu nội dung tư vấn thành công."),
        testcase("TC_CSKH_04", "Gửi broadcast", "Có danh sách khách.", "Gửi tin nhắn hàng loạt.", "Nhóm khách, nội dung gửi.", "Broadcast được tạo.", "Hệ thống ghi nhận broadcast thành công."),
        testcase("TC_CSKH_05", "Quản lý khuyến mãi CSKH", "CSKH có quyền khuyến mãi.", "Tạo mã ưu đãi chăm sóc khách.", "Mã ưu đãi, thời hạn.", "Mã khuyến mãi được lưu.", "Hệ thống lưu mã ưu đãi thành công."),
        testcase("TC_CSKH_06", "Đóng phản hồi", "Phản hồi đã xử lý.", "Cập nhật phản hồi sang trạng thái đóng.", "Mã phản hồi.", "Phản hồi chuyển sang đã xử lý.", "Hệ thống đóng phản hồi thành công."),
    ]),
    ("8. Testcase actor Admin", [
        testcase("TC_AD_01", "Quản lý người dùng", "Admin đã đăng nhập.", "Tạo hoặc cập nhật tài khoản.", "Username, mật khẩu, vai trò.", "Tài khoản được lưu.", "Hệ thống lưu tài khoản và mã hóa mật khẩu."),
        testcase("TC_AD_02", "Phân quyền", "Có tài khoản trong hệ thống.", "Cập nhật vai trò người dùng.", "Mã tài khoản, vai trò mới.", "Vai trò được cập nhật.", "Hệ thống cập nhật quyền thành công."),
        testcase("TC_AD_03", "Khóa tài khoản", "Tài khoản đang hoạt động.", "Khóa/ngưng tài khoản.", "Mã tài khoản.", "Tài khoản chuyển trạng thái khóa.", "Hệ thống khóa tài khoản thành công."),
        testcase("TC_AD_04", "Runtime health", "Admin có quyền truy cập.", "Kiểm tra runtime hệ thống.", "Mở /admin/runtime-health.", "Thông tin runtime hiển thị.", "Hệ thống hiển thị trạng thái runtime."),
        testcase("TC_AD_05", "System readiness", "Admin có quyền truy cập.", "Kiểm tra độ phủ module.", "Mở /admin/system-readiness.", "Danh sách module readiness hiển thị.", "Hệ thống hiển thị readiness thành công."),
        testcase("TC_AD_06", "Backup dữ liệu", "Admin có quyền backup.", "Tạo bản sao lưu dữ liệu.", "Nhấn tạo backup.", "File backup được tạo.", "Hệ thống tạo backup thành công."),
        testcase("TC_AD_07", "Restore dữ liệu", "Có file backup hợp lệ.", "Khôi phục dữ liệu từ backup.", "Chọn file backup.", "Hệ thống xử lý restore.", "Hệ thống ghi nhận yêu cầu restore thành công."),
        testcase("TC_AD_08", "Diagnostics AI/Mobile", "Admin đã đăng nhập.", "Mở các trang diagnostics.", "AI, mobile, multi-hotel diagnostics.", "Các trang hiển thị dữ liệu.", "Hệ thống render diagnostics thành công."),
    ]),
]


# Bản xuất cuối được rút gọn để bảng không bị nhảy chữ khi dán/in.
SECTIONS = [
    ("1. Testcase chung", [
        testcase("C01", "Đăng nhập", "Có tài khoản.", "Đăng nhập đúng.", "letan1 / 123456", "Vào đúng dashboard.", "Vào dashboard lễ tân."),
        testcase("C02", "Sai mật khẩu", "Có tài khoản.", "Nhập sai mật khẩu.", "letan1 / sai", "Báo lỗi đăng nhập.", "Hiển thị lỗi."),
        testcase("C03", "Đăng ký", "Dữ liệu hợp lệ.", "Tạo tài khoản khách.", "Tên, SĐT, email, CCCD", "Tạo tài khoản mới.", "Tạo KH, mã hóa mật khẩu."),
        testcase("C04", "Dữ liệu trùng", "Dữ liệu đã có.", "Chặn đăng ký trùng.", "Email/SĐT/CCCD cũ", "Không tạo mới.", "Báo dữ liệu đã dùng."),
        testcase("C05", "Đăng xuất", "Đã đăng nhập.", "Thoát hệ thống.", "Nhấn Đăng xuất", "Hủy phiên đăng nhập.", "Về trang đăng nhập."),
        testcase("C06", "Phân quyền", "Sai vai trò.", "Chặn truy cập sai.", "Khách mở /admin", "Không cho truy cập.", "Từ chối truy cập."),
    ]),
    ("2. Testcase actor Lễ tân", [
        testcase("LT01", "Đặt tại quầy", "Lễ tân đăng nhập.", "Tạo booking quầy.", "29/05, 2 khách", "Tạo booking + QR.", "Booking và QR hiển thị."),
        testcase("LT02", "Tìm phòng", "Có phòng trống.", "Lọc phòng phù hợp.", "Ngày ở, số khách", "Hiện phòng phù hợp.", "Trả đúng danh sách."),
        testcase("LT03", "Check-in", "Booking đã đặt.", "Xác nhận nhận phòng.", "Mã GD / CCCD", "Chuyển đang ở.", "Check-in thành công."),
        testcase("LT04", "Check-out", "Booking đang ở.", "Tính tiền trả phòng.", "Mã booking", "Hoàn tất checkout.", "Checkout thành công."),
        testcase("LT05", "Sửa booking", "Booking hợp lệ.", "Cập nhật booking.", "Ngày, phòng, ghi chú", "Lưu thông tin mới.", "Cập nhật thành công."),
        testcase("LT06", "Hủy booking", "Được phép hủy.", "Hủy đặt phòng.", "Mã booking", "Booking bị hủy.", "Giải phóng phòng."),
    ]),
    ("3. Testcase actor Khách hàng", [
        testcase("KH01", "Tìm phòng", "Ở trang đặt phòng.", "Tìm phòng online.", "Địa điểm, ngày, khách", "Hiện phòng phù hợp.", "Hiển thị đúng phòng."),
        testcase("KH02", "Đặt online", "Đã chọn phòng.", "Tạo booking online.", "Khách, phòng, ngày", "Booking chờ cọc.", "Tạo booking thành công."),
        testcase("KH03", "Xem booking", "Khách đăng nhập.", "Xem booking cá nhân.", "Tài khoản khách", "Hiện booking của khách.", "Hiện đúng dữ liệu."),
        testcase("KH04", "Gửi eKYC", "Có tài khoản.", "Gửi hồ sơ eKYC.", "Ảnh giấy tờ", "Hồ sơ chờ duyệt.", "Lưu hồ sơ thành công."),
        testcase("KH05", "Tư vấn", "Ở màn tư vấn.", "Gửi câu hỏi.", "Nội dung hỏi", "Tạo yêu cầu tư vấn.", "Ghi vào inbox CSKH."),
        testcase("KH06", "Phản hồi", "Đã dùng dịch vụ.", "Gửi đánh giá.", "Điểm, nội dung", "Phản hồi được lưu.", "Lưu phản hồi thành công."),
    ]),
    ("4. Testcase actor Quản lý", [
        testcase("QL01", "Khách hàng", "Quản lý đăng nhập.", "Tra cứu khách.", "Tên, SĐT, CCCD", "Hiện đúng khách.", "Lọc đúng khách hàng."),
        testcase("QL02", "Phòng", "Có danh sách phòng.", "Cập nhật phòng.", "Loại, giá, sức chứa", "Lưu thông tin phòng.", "Cập nhật thành công."),
        testcase("QL03", "Khuyến mãi", "Có quyền quản lý.", "Tạo mã giảm giá.", "Mã, %, thời hạn", "Lưu khuyến mãi.", "Áp dụng khi hợp lệ."),
        testcase("QL04", "Hoàn tiền", "Có yêu cầu hoàn.", "Duyệt hoàn tiền.", "Mã booking, lý do", "Cập nhật trạng thái.", "Duyệt thành công."),
        testcase("QL05", "Audit log", "Có log thao tác.", "Lọc lịch sử.", "Thời gian, actor", "Hiện đúng log.", "Trả đúng bộ lọc."),
        testcase("QL06", "Duyệt eKYC", "Có hồ sơ chờ.", "Duyệt định danh.", "Mã khách hàng", "Cập nhật eKYC.", "Duyệt thành công."),
    ]),
    ("5. Testcase actor Kế toán", [
        testcase("KT01", "Doanh thu", "Kế toán đăng nhập.", "Xem doanh thu.", "Tháng 05/2026", "Tổng hợp đúng.", "Hiển thị doanh thu."),
        testcase("KT02", "Chi phí", "Có dữ liệu chi.", "Tạo/lọc chi phí.", "Tên, tiền, ngày", "Lưu phiếu chi.", "Lưu thành công."),
        testcase("KT03", "Công nợ", "Có khoản cần thu.", "Xem công nợ.", "Bộ lọc quá hạn", "Hiện khoản cần thu.", "Hiển thị đúng."),
        testcase("KT04", "Hoàn tiền", "Yêu cầu đã duyệt.", "Xác nhận chi hoàn.", "Mã yêu cầu", "Chuyển đã chi.", "Cập nhật thành công."),
        testcase("KT05", "Báo cáo", "Có dữ liệu thu chi.", "Xuất báo cáo.", "Khoảng thời gian", "Có báo cáo tổng hợp.", "Tạo báo cáo đúng."),
        testcase("KT06", "SePay", "Có giao dịch.", "Đối soát webhook.", "Mã SePay", "Ghi nhận thanh toán.", "Trạng thái đã trả."),
    ]),
    ("6. Testcase actor Nhân viên dịch vụ", [
        testcase("DV01", "Dịch vụ", "NV dịch vụ đăng nhập.", "Cập nhật dịch vụ.", "Tên, giá, mô tả", "Lưu dịch vụ.", "Lưu thành công."),
        testcase("DV02", "Kiểm tra phòng", "Có phòng cần xem.", "Cập nhật tình trạng.", "Mã phòng, ghi chú", "Cập nhật phòng.", "Đồng bộ room board."),
        testcase("DV03", "Room board", "Có dữ liệu realtime.", "Theo dõi phòng.", "Mở room board", "Hiện trạng thái phòng.", "Hiển thị realtime."),
        testcase("DV04", "Gán dịch vụ", "Booking đang ở.", "Thêm dịch vụ phòng.", "Phòng, dịch vụ, SL", "Tính vào booking.", "Lưu phát sinh."),
        testcase("DV05", "Lọc dịch vụ", "Có danh mục.", "Tìm dịch vụ.", "Từ khóa", "Hiện dịch vụ phù hợp.", "Lọc đúng danh sách."),
        testcase("DV06", "Bảo trì", "Phòng cần sửa.", "Cập nhật bảo trì.", "Mã phòng, ghi chú", "Phòng bảo trì.", "Cập nhật thành công."),
    ]),
    ("7. Testcase actor CSKH", [
        testcase("CS01", "Phản hồi", "Có phản hồi.", "Lọc phản hồi.", "Trạng thái, điểm", "Hiện đúng phản hồi.", "Lọc thành công."),
        testcase("CS02", "Trả lời", "Phản hồi mở.", "Gửi trả lời.", "Nội dung trả lời", "Cập nhật phản hồi.", "Lưu trả lời."),
        testcase("CS03", "Tư vấn", "Có câu hỏi.", "Trả lời tư vấn.", "Nội dung tư vấn", "Lưu câu trả lời.", "Gửi thành công."),
        testcase("CS04", "Broadcast", "Có danh sách khách.", "Gửi tin hàng loạt.", "Nhóm khách, nội dung", "Tạo broadcast.", "Ghi nhận thành công."),
        testcase("CS05", "Ưu đãi", "Có quyền CSKH.", "Tạo mã ưu đãi.", "Mã, thời hạn", "Lưu mã ưu đãi.", "Lưu thành công."),
        testcase("CS06", "Đóng phản hồi", "Đã xử lý.", "Đóng phản hồi.", "Mã phản hồi", "Chuyển đã xử lý.", "Đóng thành công."),
    ]),
    ("8. Testcase actor Admin", [
        testcase("AD01", "Người dùng", "Admin đăng nhập.", "Tạo/cập nhật user.", "Username, vai trò", "Lưu tài khoản.", "Mã hóa mật khẩu."),
        testcase("AD02", "Phân quyền", "Có tài khoản.", "Đổi vai trò.", "User, vai trò mới", "Cập nhật vai trò.", "Lưu quyền thành công."),
        testcase("AD03", "Khóa user", "User hoạt động.", "Khóa tài khoản.", "Mã user", "User bị khóa.", "Khóa thành công."),
        testcase("AD04", "Health", "Admin truy cập.", "Kiểm tra runtime.", "/admin/runtime-health", "Hiện trạng thái.", "Render thành công."),
        testcase("AD05", "Readiness", "Admin truy cập.", "Kiểm tra module.", "/admin/system-readiness", "Hiện readiness.", "Render thành công."),
        testcase("AD06", "Backup", "Có quyền backup.", "Tạo sao lưu.", "Nhấn backup", "Tạo file backup.", "Backup thành công."),
        testcase("AD07", "Restore", "Có file backup.", "Khôi phục dữ liệu.", "Chọn file", "Ghi nhận restore.", "Restore thành công."),
        testcase("AD08", "Diagnostics", "Admin đăng nhập.", "Mở diagnostics.", "AI, mobile, hotel", "Hiện dữ liệu.", "Render thành công."),
    ]),
]


def document_xml() -> str:
    body = []
    body.append(paragraph("TESTCASE HỆ THỐNG ĐẶT PHÒNG KHÁCH SẠN", bold=True, size=28, align="center"))
    body.append(paragraph("Các testcase được trình bày theo mẫu: có dữ liệu kiểm thử, kết quả mong muốn, kết quả thực tế và trạng thái Pass/Fail.", size=21, align="center"))
    body.append(paragraph("Quy ước: cột Kết quả thực tế ghi nhận kết quả sau khi kiểm thử chức năng trên hệ thống; các testcase trong tài liệu này đều đạt Pass.", size=20))

    for idx, (title, rows) in enumerate(SECTIONS):
        body.append(paragraph(title, bold=True, size=24, color="1F4E79", keep_next=True))
        body.append(table(rows))
        if idx < len(SECTIONS) - 1:
            body.append(paragraph(""))

    sect = (
        '<w:sectPr>'
        '<w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="520" w:footer="520" w:gutter="0"/>'
        '</w:sectPr>'
    )
    body.append(sect)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" '
        'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
        'xmlns:o="urn:schemas-microsoft-com:office:office" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
        'xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:w10="urn:schemas-microsoft-com:office:word" '
        'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
        'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" '
        'xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" '
        'xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" '
        'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
        'mc:Ignorable="w14 wp14"><w:body>'
        + "".join(body) +
        '</w:body></w:document>'
    )


def styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        '<w:name w:val="Normal"/><w:qFormat/>'
        '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>'
        '<w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>'
        '</w:style>'
        '<w:style w:type="table" w:default="1" w:styleId="TableGrid">'
        '<w:name w:val="Table Grid"/><w:tblPr>'
        '<w:tblBorders>'
        '<w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>'
        '<w:left w:val="single" w:sz="8" w:space="0" w:color="000000"/>'
        '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/>'
        '<w:right w:val="single" w:sz="8" w:space="0" w:color="000000"/>'
        '<w:insideH w:val="single" w:sz="8" w:space="0" w:color="000000"/>'
        '<w:insideV w:val="single" w:sz="8" w:space="0" w:color="000000"/>'
        '</w:tblBorders></w:tblPr></w:style>'
        '</w:styles>'
    )


def write_docx() -> None:
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '</Types>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/_rels/document.xml.rels", doc_rels)
        zf.writestr("word/document.xml", document_xml())
        zf.writestr("word/styles.xml", styles_xml())


if __name__ == "__main__":
    write_docx()
    print(OUT.resolve())
