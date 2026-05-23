--
-- PostgreSQL database dump
--

\restrict 7cpmPgDb208x3foIfxgUBBGdmgF73oO2fa71zFYPhGTVHxRxScdRhOfaKJKptUP

-- Dumped from database version 17.0
-- Dumped by pg_dump version 17.9 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: abc_resort1; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA abc_resort1;


--
-- Name: api_request_log_thietbi; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.api_request_log_thietbi AS ENUM (
    'Web',
    'Mobile',
    'Admin'
);


--
-- Name: audit_log_khachhang_hanhdong; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.audit_log_khachhang_hanhdong AS ENUM (
    'CREATE',
    'UPDATE',
    'DELETE',
    'RESET_PASSWORD'
);


--
-- Name: booking_history_ketqua; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.booking_history_ketqua AS ENUM (
    'Booked',
    'Cancelled',
    'Stayed'
);


--
-- Name: chiphi_trangthai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.chiphi_trangthai AS ENUM (
    'ChoDuyet',
    'DaDuyet',
    'Huy'
);


--
-- Name: chitietdichvu_trangthaidichvu; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.chitietdichvu_trangthaidichvu AS ENUM (
    'ChuaSuDung',
    'DangSuDung',
    'DaSuDung'
);


--
-- Name: chitietgiaodich_trangthai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.chitietgiaodich_trangthai AS ENUM (
    'Booked',
    'CheckedIn',
    'CheckedOut',
    'Cancelled'
);


--
-- Name: congnophaithu_trangthaithanhtoan; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.congnophaithu_trangthaithanhtoan AS ENUM (
    'ChuaThu',
    'ThuMotPhan',
    'DaThu',
    'QuaHan'
);


--
-- Name: dichvu_trangthai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.dichvu_trangthai AS ENUM (
    'HoatDong',
    'NgungBan',
    'BaoTri'
);


--
-- Name: ekyc_verification_ketquaxacthuc; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.ekyc_verification_ketquaxacthuc AS ENUM (
    'ChuaXacThuc',
    'DangXuLy',
    'ThanhCong',
    'ThatBai'
);


--
-- Name: ekyc_verification_loaigiayto; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.ekyc_verification_loaigiayto AS ENUM (
    'CCCD',
    'CMND',
    'Passport'
);


--
-- Name: giaodich_loaigiaodich; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.giaodich_loaigiaodich AS ENUM (
    'DatPhong',
    'ThueTrucTiep'
);


--
-- Name: giaodich_nguondat; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.giaodich_nguondat AS ENUM (
    'Web',
    'Mobile',
    'LeTan',
    'AdminAPI'
);


--
-- Name: giaodich_phuongthucthanhtoan; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.giaodich_phuongthucthanhtoan AS ENUM (
    'ChuaThanhToan',
    'TienMat',
    'The',
    'ChuyenKhoan',
    'ViDienTu'
);


--
-- Name: giaodich_trangthai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.giaodich_trangthai AS ENUM (
    'Moi',
    'Booked',
    'DaHuy',
    'Stayed',
    'Paid'
);


--
-- Name: hoadon_phuongthucthanhtoan; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.hoadon_phuongthucthanhtoan AS ENUM (
    'TienMat',
    'The',
    'ChuyenKhoan',
    'ViDienTu'
);


--
-- Name: hoadon_trangthai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.hoadon_trangthai AS ENUM (
    'ChuaThanhToan',
    'DaThanhToan',
    'DaHuy'
);


--
-- Name: khachhang_trangthaiekyc; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.khachhang_trangthaiekyc AS ENUM (
    'ChuaXacThuc',
    'DaXacThuc',
    'ThatBai'
);


--
-- Name: khachsan_trangthai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.khachsan_trangthai AS ENUM (
    'HoatDong',
    'TamNgung'
);


--
-- Name: khuyenmai_loaiuudai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.khuyenmai_loaiuudai AS ENUM (
    'PERCENT',
    'FIXED'
);


--
-- Name: khuyenmai_trangthai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.khuyenmai_trangthai AS ENUM (
    'DangApDung',
    'TamNgung',
    'HetHan'
);


--
-- Name: kiem_toan_dem_trangthai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.kiem_toan_dem_trangthai AS ENUM (
    'DangKiemToan',
    'DaKiemToan',
    'ChuaKiemToan'
);


--
-- Name: phanhoi_sentiment; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.phanhoi_sentiment AS ENUM (
    'Positive',
    'Neutral',
    'Negative'
);


--
-- Name: phanhoi_tinhtrang; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.phanhoi_tinhtrang AS ENUM (
    'ChuaXuLy',
    'DangXuLy',
    'DaXuLy'
);


--
-- Name: phong_tinhtrangphong; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.phong_tinhtrangphong AS ENUM (
    'Tot',
    'CanVeSinh',
    'HuHaiNhe',
    'HuHaiNang',
    'DangBaoTri'
);


--
-- Name: phong_trangthai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.phong_trangthai AS ENUM (
    'Trong',
    'Booked',
    'Stayed',
    'BaoTri'
);


--
-- Name: phong_trangthairealtime; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.phong_trangthairealtime AS ENUM (
    'Available',
    'Locked',
    'Booked',
    'Stayed',
    'Cleaning',
    'Maintenance'
);


--
-- Name: room_status_log_nguonthaydoi; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.room_status_log_nguonthaydoi AS ENUM (
    'API',
    'LeTan',
    'HeThong'
);


--
-- Name: taikhoan_trangthai; Type: TYPE; Schema: abc_resort1; Owner: -
--

CREATE TYPE abc_resort1.taikhoan_trangthai AS ENUM (
    'HoatDong',
    'Khoa',
    'Ngung'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_request_log; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.api_request_log (
    malog integer NOT NULL,
    endpoint character varying(255) NOT NULL,
    method character varying(10) NOT NULL,
    matk integer,
    thietbi abc_resort1.api_request_log_thietbi DEFAULT 'Web'::abc_resort1.api_request_log_thietbi,
    requestat timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    statuscode integer DEFAULT 200
);


--
-- Name: api_request_log_malog_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.api_request_log_malog_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_request_log_malog_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.api_request_log_malog_seq OWNED BY abc_resort1.api_request_log.malog;


--
-- Name: audit_log_khachhang; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.audit_log_khachhang (
    maaudit integer NOT NULL,
    makhachhang integer NOT NULL,
    hanhdong abc_resort1.audit_log_khachhang_hanhdong NOT NULL,
    dulieucu text,
    dulieumoi text,
    manhanvien integer,
    usernamethuchien character varying(100),
    thoigian timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ghichu character varying(255)
);


--
-- Name: audit_log_khachhang_maaudit_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.audit_log_khachhang_maaudit_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_khachhang_maaudit_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.audit_log_khachhang_maaudit_seq OWNED BY abc_resort1.audit_log_khachhang.maaudit;


--
-- Name: booking_history; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.booking_history (
    malichsu integer NOT NULL,
    makhachhang integer NOT NULL,
    maphong integer NOT NULL,
    magiaodich integer,
    ngaydat timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    songuoi integer DEFAULT 1,
    dongia numeric(12,2) DEFAULT 0.00,
    ketqua abc_resort1.booking_history_ketqua DEFAULT 'Booked'::abc_resort1.booking_history_ketqua
);


--
-- Name: booking_history_malichsu_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.booking_history_malichsu_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: booking_history_malichsu_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.booking_history_malichsu_seq OWNED BY abc_resort1.booking_history.malichsu;


--
-- Name: chiphi; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.chiphi (
    macp integer NOT NULL,
    tenchiphi character varying(100) NOT NULL,
    ngaychi date NOT NULL,
    sotien numeric(14,2) DEFAULT 0.00 NOT NULL,
    noidung character varying(300),
    trangthai abc_resort1.chiphi_trangthai DEFAULT 'ChoDuyet'::abc_resort1.chiphi_trangthai,
    makhachsan integer,
    loaichiphi character varying(40),
    nhacungcap character varying(180),
    sohoadon character varying(80),
    phuongthucchi character varying(40),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chiphi_macp_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.chiphi_macp_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chiphi_macp_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.chiphi_macp_seq OWNED BY abc_resort1.chiphi.macp;


--
-- Name: chitietdichvu; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.chitietdichvu (
    mactdv integer NOT NULL,
    magiaodich integer NOT NULL,
    maphong integer,
    madichvu integer NOT NULL,
    soluong integer DEFAULT 1 NOT NULL,
    giaban numeric(12,2) DEFAULT 0.00 NOT NULL,
    thanhtien numeric(12,2) DEFAULT 0.00 NOT NULL,
    thoidiemghinhan timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ghichu character varying(300),
    ngaydat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    trangthaidichvu abc_resort1.chitietdichvu_trangthaidichvu DEFAULT 'ChuaSuDung'::abc_resort1.chitietdichvu_trangthaidichvu NOT NULL
);


--
-- Name: chitietdichvu_mactdv_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.chitietdichvu_mactdv_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chitietdichvu_mactdv_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.chitietdichvu_mactdv_seq OWNED BY abc_resort1.chitietdichvu.mactdv;


--
-- Name: chitietgiaodich; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.chitietgiaodich (
    mactgd integer NOT NULL,
    magiaodich integer NOT NULL,
    maphong integer NOT NULL,
    songuoi integer DEFAULT 1,
    ngaynhandukien timestamp with time zone,
    ngaytradukien timestamp with time zone,
    ngaycheckin timestamp with time zone,
    ngaycheckout timestamp with time zone,
    dongia numeric(14,2) DEFAULT 0.00,
    thanhtien numeric(14,2) DEFAULT 0.00,
    tienphuthu numeric(14,2) DEFAULT 0.00,
    tienboithuong numeric(14,2) DEFAULT 0.00,
    trangthai abc_resort1.chitietgiaodich_trangthai DEFAULT 'Booked'::abc_resort1.chitietgiaodich_trangthai,
    ghichu character varying(500),
    tenkhach character varying(100),
    cccd character varying(20),
    sdt character varying(20),
    email character varying(100),
    makhuyenmai integer
);


--
-- Name: chitietgiaodich_mactgd_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.chitietgiaodich_mactgd_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chitietgiaodich_mactgd_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.chitietgiaodich_mactgd_seq OWNED BY abc_resort1.chitietgiaodich.mactgd;


--
-- Name: chitietphanhoi; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.chitietphanhoi (
    mactphanhoi integer NOT NULL,
    maphanhoi integer NOT NULL,
    manhanvien integer,
    ngaytraloi timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    noidungtraloi character varying(500)
);


--
-- Name: chitietphanhoi_mactphanhoi_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.chitietphanhoi_mactphanhoi_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chitietphanhoi_mactphanhoi_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.chitietphanhoi_mactphanhoi_seq OWNED BY abc_resort1.chitietphanhoi.mactphanhoi;


--
-- Name: congnophaithu; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.congnophaithu (
    macongno integer NOT NULL,
    makhachhang integer NOT NULL,
    magiaodich integer,
    sotiengoc numeric(14,2) DEFAULT 0.00 NOT NULL,
    sotiendathu numeric(14,2) DEFAULT 0.00 NOT NULL,
    ngayphatsinh date NOT NULL,
    ngaydenhan date,
    trangthaithanhtoan abc_resort1.congnophaithu_trangthaithanhtoan DEFAULT 'ChuaThu'::abc_resort1.congnophaithu_trangthaithanhtoan,
    ghichu text,
    ngaytao timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ngaycapnhat timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: congnophaithu_macongno_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.congnophaithu_macongno_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: congnophaithu_macongno_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.congnophaithu_macongno_seq OWNED BY abc_resort1.congnophaithu.macongno;


--
-- Name: cskh_broadcast_campaign; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.cskh_broadcast_campaign (
    id bigint NOT NULL,
    title character varying(140) NOT NULL,
    template_key character varying(40) NOT NULL,
    audience_key character varying(40) NOT NULL,
    channel character varying(12) NOT NULL,
    message text NOT NULL,
    status character varying(20) DEFAULT 'Queued'::character varying NOT NULL,
    recipient_count integer DEFAULT 0 NOT NULL,
    email_count integer DEFAULT 0 NOT NULL,
    phone_count integer DEFAULT 0 NOT NULL,
    created_by integer,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cskh_broadcast_campaign_id_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.cskh_broadcast_campaign_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cskh_broadcast_campaign_id_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.cskh_broadcast_campaign_id_seq OWNED BY abc_resort1.cskh_broadcast_campaign.id;


--
-- Name: cskh_broadcast_recipient; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.cskh_broadcast_recipient (
    id bigint NOT NULL,
    campaign_id bigint NOT NULL,
    customer_id integer,
    customer_name character varying(255),
    email character varying(255),
    phone character varying(50),
    booking_id integer,
    hotel_name character varying(255),
    reason text,
    checkin_at timestamp with time zone,
    checkout_at timestamp with time zone,
    delivery_channel character varying(12) NOT NULL,
    delivery_status character varying(20) DEFAULT 'Queued'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cskh_broadcast_recipient_id_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.cskh_broadcast_recipient_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cskh_broadcast_recipient_id_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.cskh_broadcast_recipient_id_seq OWNED BY abc_resort1.cskh_broadcast_recipient.id;


--
-- Name: dichvu; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.dichvu (
    madichvu integer NOT NULL,
    tendichvu character varying(150) NOT NULL,
    giadichvu numeric(12,2) DEFAULT 0.00 NOT NULL,
    mota character varying(500),
    trangthai abc_resort1.dichvu_trangthai DEFAULT 'HoatDong'::abc_resort1.dichvu_trangthai,
    hinhanh character varying(255)
);


--
-- Name: dichvu_madichvu_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.dichvu_madichvu_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dichvu_madichvu_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.dichvu_madichvu_seq OWNED BY abc_resort1.dichvu.madichvu;


--
-- Name: doan; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.doan (
    madoan integer NOT NULL,
    tendoan character varying(150),
    matruongdoan integer,
    songuoi integer DEFAULT 0,
    ngayden date,
    ngaydi date,
    ghichu character varying(300)
);


--
-- Name: doan_madoan_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.doan_madoan_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: doan_madoan_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.doan_madoan_seq OWNED BY abc_resort1.doan.madoan;


--
-- Name: ekyc_verification; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.ekyc_verification (
    maekyc integer NOT NULL,
    makhachhang integer NOT NULL,
    sogiayto character varying(20),
    loaigiayto abc_resort1.ekyc_verification_loaigiayto DEFAULT 'CCCD'::abc_resort1.ekyc_verification_loaigiayto,
    anhmattruoc character varying(255),
    anhmatsau character varying(255),
    anhselfie character varying(255),
    ketquaxacthuc abc_resort1.ekyc_verification_ketquaxacthuc DEFAULT 'ChuaXacThuc'::abc_resort1.ekyc_verification_ketquaxacthuc,
    dotincay numeric(5,2),
    thoigiangui timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    thoigianxacthuc timestamp with time zone,
    ghichu character varying(255)
);


--
-- Name: ekyc_verification_maekyc_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.ekyc_verification_maekyc_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ekyc_verification_maekyc_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.ekyc_verification_maekyc_seq OWNED BY abc_resort1.ekyc_verification.maekyc;


--
-- Name: giaodich; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.giaodich (
    magiaodich integer NOT NULL,
    makhachhang integer,
    madoan integer,
    manhanvien integer,
    makhuyenmai integer,
    madatcho character varying(30),
    ngaygiaodich timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    loaigiaodich abc_resort1.giaodich_loaigiaodich DEFAULT 'DatPhong'::abc_resort1.giaodich_loaigiaodich,
    nguondat abc_resort1.giaodich_nguondat DEFAULT 'Web'::abc_resort1.giaodich_nguondat,
    tongtien numeric(14,2) DEFAULT 0.00,
    trangthai abc_resort1.giaodich_trangthai DEFAULT 'Moi'::abc_resort1.giaodich_trangthai NOT NULL,
    phuongthucthanhtoan abc_resort1.giaodich_phuongthucthanhtoan DEFAULT 'ChuaThanhToan'::abc_resort1.giaodich_phuongthucthanhtoan,
    ghichu text
);


--
-- Name: giaodich_magiaodich_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.giaodich_magiaodich_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: giaodich_magiaodich_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.giaodich_magiaodich_seq OWNED BY abc_resort1.giaodich.magiaodich;


--
-- Name: hoadon; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.hoadon (
    mahoadon integer NOT NULL,
    magiaodich integer NOT NULL,
    makhachhang integer,
    manhanvien integer,
    ngaylap timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tongtien numeric(14,2) DEFAULT 0.00,
    phuongthucthanhtoan abc_resort1.hoadon_phuongthucthanhtoan DEFAULT 'TienMat'::abc_resort1.hoadon_phuongthucthanhtoan,
    trangthai abc_resort1.hoadon_trangthai DEFAULT 'ChuaThanhToan'::abc_resort1.hoadon_trangthai,
    ghichu character varying(500)
);


--
-- Name: hoadon_mahoadon_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.hoadon_mahoadon_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hoadon_mahoadon_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.hoadon_mahoadon_seq OWNED BY abc_resort1.hoadon.mahoadon;


--
-- Name: khachhang; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.khachhang (
    makhachhang integer NOT NULL,
    matk integer,
    tenkh character varying(100) NOT NULL,
    sdt character varying(20),
    email character varying(100),
    cccd character varying(20),
    diachi character varying(200),
    loaikhach character varying(50),
    trangthaiekyc abc_resort1.khachhang_trangthaiekyc DEFAULT 'ChuaXacThuc'::abc_resort1.khachhang_trangthaiekyc,
    magiaodich integer
);


--
-- Name: khachhang_makhachhang_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.khachhang_makhachhang_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: khachhang_makhachhang_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.khachhang_makhachhang_seq OWNED BY abc_resort1.khachhang.makhachhang;


--
-- Name: khachsan; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.khachsan (
    makhachsan integer NOT NULL,
    tenkhachsan character varying(150) NOT NULL,
    tinhthanh character varying(100) NOT NULL,
    quanhuyen character varying(100),
    diachi character varying(255),
    vido numeric(10,7),
    kinhdo numeric(10,7),
    sodienthoai character varying(20),
    email character varying(120),
    trangthai abc_resort1.khachsan_trangthai DEFAULT 'HoatDong'::abc_resort1.khachsan_trangthai,
    ngaytao timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: khachsan_makhachsan_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.khachsan_makhachsan_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: khachsan_makhachsan_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.khachsan_makhachsan_seq OWNED BY abc_resort1.khachsan.makhachsan;


--
-- Name: khuyenmai; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.khuyenmai (
    makhuyenmai integer NOT NULL,
    tenchuongtrinh character varying(150) NOT NULL,
    ngaybatdau date,
    ngayketthuc date,
    mucuudai numeric(5,2) DEFAULT 0.00,
    doituong text,
    trangthai abc_resort1.khuyenmai_trangthai DEFAULT 'DangApDung'::abc_resort1.khuyenmai_trangthai,
    loaiuudai abc_resort1.khuyenmai_loaiuudai DEFAULT 'PERCENT'::abc_resort1.khuyenmai_loaiuudai NOT NULL
);


--
-- Name: khuyenmai_makhuyenmai_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.khuyenmai_makhuyenmai_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: khuyenmai_makhuyenmai_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.khuyenmai_makhuyenmai_seq OWNED BY abc_resort1.khuyenmai.makhuyenmai;


--
-- Name: kiem_toan_dem; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.kiem_toan_dem (
    maktd integer NOT NULL,
    ngayktd date NOT NULL,
    mataikhoan integer,
    sodudaungay numeric(14,2) DEFAULT 0.00,
    soducuoingay numeric(14,2) DEFAULT 0.00,
    tongdoanhthu numeric(14,2) DEFAULT 0.00,
    tongchiphi numeric(14,2) DEFAULT 0.00,
    loinhuan numeric(14,2) DEFAULT 0.00,
    trangthai abc_resort1.kiem_toan_dem_trangthai DEFAULT 'ChuaKiemToan'::abc_resort1.kiem_toan_dem_trangthai,
    ghichu text,
    thoigiantao timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    thoigiancapnhat timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: kiem_toan_dem_maktd_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.kiem_toan_dem_maktd_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kiem_toan_dem_maktd_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.kiem_toan_dem_maktd_seq OWNED BY abc_resort1.kiem_toan_dem.maktd;


--
-- Name: nhanvien; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.nhanvien (
    manhanvien integer NOT NULL,
    tennv character varying(100) NOT NULL,
    sdt character varying(20),
    email character varying(100),
    chucvu character varying(50),
    mavaitro integer NOT NULL
);


--
-- Name: nhanvien_manhanvien_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.nhanvien_manhanvien_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nhanvien_manhanvien_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.nhanvien_manhanvien_seq OWNED BY abc_resort1.nhanvien.manhanvien;


--
-- Name: node_sessions; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.node_sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: phanhoi; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.phanhoi (
    maph integer NOT NULL,
    makhachhang integer,
    loaidichvu character varying(255),
    mucdohailong integer,
    tepdinhkem character varying(255),
    hotenkh character varying(150),
    email character varying(100),
    sdt character varying(20),
    noidung text NOT NULL,
    sentiment abc_resort1.phanhoi_sentiment DEFAULT 'Neutral'::abc_resort1.phanhoi_sentiment,
    diemcamxuc numeric(5,2),
    tinhtrang abc_resort1.phanhoi_tinhtrang DEFAULT 'ChuaXuLy'::abc_resort1.phanhoi_tinhtrang,
    ngayphanhoi timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: phanhoi_maph_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.phanhoi_maph_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: phanhoi_maph_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.phanhoi_maph_seq OWNED BY abc_resort1.phanhoi.maph;


--
-- Name: phong; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.phong (
    maphong integer NOT NULL,
    makhachsan integer NOT NULL,
    sophong character varying(10) NOT NULL,
    loaiphong character varying(50) NOT NULL,
    dientich double precision NOT NULL,
    loaigiuong character varying(50) NOT NULL,
    viewphong character varying(50),
    gia numeric(12,2) NOT NULL,
    trangthai abc_resort1.phong_trangthai DEFAULT 'Trong'::abc_resort1.phong_trangthai NOT NULL,
    trangthairealtime abc_resort1.phong_trangthairealtime DEFAULT 'Available'::abc_resort1.phong_trangthairealtime,
    sokhachtoida integer DEFAULT 1 NOT NULL,
    ghichu character varying(255),
    tinhtrangphong abc_resort1.phong_tinhtrangphong DEFAULT 'Tot'::abc_resort1.phong_tinhtrangphong NOT NULL,
    hinhanh character varying(255),
    douutienhienthi integer DEFAULT 0,
    vitri character varying(180)
);


--
-- Name: phong_maphong_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.phong_maphong_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: phong_maphong_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.phong_maphong_seq OWNED BY abc_resort1.phong.maphong;


--
-- Name: refund_requests; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.refund_requests (
    id integer NOT NULL,
    magiaodich integer NOT NULL,
    refund_code text NOT NULL,
    scope text DEFAULT 'all'::text NOT NULL,
    room_ids text DEFAULT ''::text NOT NULL,
    customer_name text,
    customer_phone text,
    customer_email text,
    bank_name text NOT NULL,
    bank_account_no text NOT NULL,
    bank_account_name text NOT NULL,
    reason text NOT NULL,
    note text,
    deposit_paid numeric(14,2) DEFAULT 0 NOT NULL,
    retained_deposit numeric(14,2) DEFAULT 0 NOT NULL,
    already_requested numeric(14,2) DEFAULT 0 NOT NULL,
    amount_requested numeric(14,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(14,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'ChoXuLy'::text NOT NULL,
    created_by_role text DEFAULT 'LeTan'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    accounting_note text,
    expense_id integer,
    refundable_base numeric(14,2) DEFAULT 0 NOT NULL,
    refund_rate numeric(5,2) DEFAULT 0 NOT NULL,
    hours_before_checkin numeric(10,2),
    cancellation_policy_key text,
    cancellation_policy_label text,
    cancellation_policy_note text,
    manager_note text,
    manager_reviewed_at timestamp with time zone,
    manager_by text,
    refund_payment_content text,
    refund_bank_txn_id text,
    refund_payment_proof text,
    refund_paid_at timestamp with time zone,
    refund_paid_by text
);


--
-- Name: refund_requests_id_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.refund_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refund_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.refund_requests_id_seq OWNED BY abc_resort1.refund_requests.id;


--
-- Name: room_status_log; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.room_status_log (
    malog integer NOT NULL,
    maphong integer NOT NULL,
    trangthaicu character varying(30),
    trangthaimoi character varying(30) NOT NULL,
    nguonthaydoi abc_resort1.room_status_log_nguonthaydoi DEFAULT 'API'::abc_resort1.room_status_log_nguonthaydoi,
    magiaodich integer,
    thoidiem timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ghichu character varying(255)
);


--
-- Name: room_status_log_malog_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.room_status_log_malog_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: room_status_log_malog_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.room_status_log_malog_seq OWNED BY abc_resort1.room_status_log.malog;


--
-- Name: taikhoan; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.taikhoan (
    matk integer NOT NULL,
    username character varying(100) NOT NULL,
    password character varying(255) NOT NULL,
    ngaytao timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    trangthai abc_resort1.taikhoan_trangthai DEFAULT 'HoatDong'::abc_resort1.taikhoan_trangthai NOT NULL,
    mavaitro integer NOT NULL,
    motaquyen text,
    makhachhang integer,
    manhanvien integer
);


--
-- Name: taikhoan_matk_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.taikhoan_matk_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: taikhoan_matk_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.taikhoan_matk_seq OWNED BY abc_resort1.taikhoan.matk;


--
-- Name: thietbi; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.thietbi (
    mathietbi integer NOT NULL,
    tenthietbi character varying(100) NOT NULL,
    soluong integer DEFAULT 1 NOT NULL,
    tinhtrang character varying(50) DEFAULT 'Tốt'::character varying NOT NULL,
    maphong integer
);


--
-- Name: thietbi_mathietbi_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.thietbi_mathietbi_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: thietbi_mathietbi_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.thietbi_mathietbi_seq OWNED BY abc_resort1.thietbi.mathietbi;


--
-- Name: vaitro; Type: TABLE; Schema: abc_resort1; Owner: -
--

CREATE TABLE abc_resort1.vaitro (
    mavaitro integer NOT NULL,
    tenvaitro character varying(50) NOT NULL,
    mota text
);


--
-- Name: vaitro_mavaitro_seq; Type: SEQUENCE; Schema: abc_resort1; Owner: -
--

CREATE SEQUENCE abc_resort1.vaitro_mavaitro_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vaitro_mavaitro_seq; Type: SEQUENCE OWNED BY; Schema: abc_resort1; Owner: -
--

ALTER SEQUENCE abc_resort1.vaitro_mavaitro_seq OWNED BY abc_resort1.vaitro.mavaitro;


--
-- Name: api_request_log malog; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.api_request_log ALTER COLUMN malog SET DEFAULT nextval('abc_resort1.api_request_log_malog_seq'::regclass);


--
-- Name: audit_log_khachhang maaudit; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.audit_log_khachhang ALTER COLUMN maaudit SET DEFAULT nextval('abc_resort1.audit_log_khachhang_maaudit_seq'::regclass);


--
-- Name: booking_history malichsu; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.booking_history ALTER COLUMN malichsu SET DEFAULT nextval('abc_resort1.booking_history_malichsu_seq'::regclass);


--
-- Name: chiphi macp; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chiphi ALTER COLUMN macp SET DEFAULT nextval('abc_resort1.chiphi_macp_seq'::regclass);


--
-- Name: chitietdichvu mactdv; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietdichvu ALTER COLUMN mactdv SET DEFAULT nextval('abc_resort1.chitietdichvu_mactdv_seq'::regclass);


--
-- Name: chitietgiaodich mactgd; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietgiaodich ALTER COLUMN mactgd SET DEFAULT nextval('abc_resort1.chitietgiaodich_mactgd_seq'::regclass);


--
-- Name: chitietphanhoi mactphanhoi; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietphanhoi ALTER COLUMN mactphanhoi SET DEFAULT nextval('abc_resort1.chitietphanhoi_mactphanhoi_seq'::regclass);


--
-- Name: congnophaithu macongno; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.congnophaithu ALTER COLUMN macongno SET DEFAULT nextval('abc_resort1.congnophaithu_macongno_seq'::regclass);


--
-- Name: cskh_broadcast_campaign id; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.cskh_broadcast_campaign ALTER COLUMN id SET DEFAULT nextval('abc_resort1.cskh_broadcast_campaign_id_seq'::regclass);


--
-- Name: cskh_broadcast_recipient id; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.cskh_broadcast_recipient ALTER COLUMN id SET DEFAULT nextval('abc_resort1.cskh_broadcast_recipient_id_seq'::regclass);


--
-- Name: dichvu madichvu; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.dichvu ALTER COLUMN madichvu SET DEFAULT nextval('abc_resort1.dichvu_madichvu_seq'::regclass);


--
-- Name: doan madoan; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.doan ALTER COLUMN madoan SET DEFAULT nextval('abc_resort1.doan_madoan_seq'::regclass);


--
-- Name: ekyc_verification maekyc; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.ekyc_verification ALTER COLUMN maekyc SET DEFAULT nextval('abc_resort1.ekyc_verification_maekyc_seq'::regclass);


--
-- Name: giaodich magiaodich; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.giaodich ALTER COLUMN magiaodich SET DEFAULT nextval('abc_resort1.giaodich_magiaodich_seq'::regclass);


--
-- Name: hoadon mahoadon; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.hoadon ALTER COLUMN mahoadon SET DEFAULT nextval('abc_resort1.hoadon_mahoadon_seq'::regclass);


--
-- Name: khachhang makhachhang; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.khachhang ALTER COLUMN makhachhang SET DEFAULT nextval('abc_resort1.khachhang_makhachhang_seq'::regclass);


--
-- Name: khachsan makhachsan; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.khachsan ALTER COLUMN makhachsan SET DEFAULT nextval('abc_resort1.khachsan_makhachsan_seq'::regclass);


--
-- Name: khuyenmai makhuyenmai; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.khuyenmai ALTER COLUMN makhuyenmai SET DEFAULT nextval('abc_resort1.khuyenmai_makhuyenmai_seq'::regclass);


--
-- Name: kiem_toan_dem maktd; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.kiem_toan_dem ALTER COLUMN maktd SET DEFAULT nextval('abc_resort1.kiem_toan_dem_maktd_seq'::regclass);


--
-- Name: nhanvien manhanvien; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.nhanvien ALTER COLUMN manhanvien SET DEFAULT nextval('abc_resort1.nhanvien_manhanvien_seq'::regclass);


--
-- Name: phanhoi maph; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.phanhoi ALTER COLUMN maph SET DEFAULT nextval('abc_resort1.phanhoi_maph_seq'::regclass);


--
-- Name: phong maphong; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.phong ALTER COLUMN maphong SET DEFAULT nextval('abc_resort1.phong_maphong_seq'::regclass);


--
-- Name: refund_requests id; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.refund_requests ALTER COLUMN id SET DEFAULT nextval('abc_resort1.refund_requests_id_seq'::regclass);


--
-- Name: room_status_log malog; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.room_status_log ALTER COLUMN malog SET DEFAULT nextval('abc_resort1.room_status_log_malog_seq'::regclass);


--
-- Name: taikhoan matk; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.taikhoan ALTER COLUMN matk SET DEFAULT nextval('abc_resort1.taikhoan_matk_seq'::regclass);


--
-- Name: thietbi mathietbi; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.thietbi ALTER COLUMN mathietbi SET DEFAULT nextval('abc_resort1.thietbi_mathietbi_seq'::regclass);


--
-- Name: vaitro mavaitro; Type: DEFAULT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.vaitro ALTER COLUMN mavaitro SET DEFAULT nextval('abc_resort1.vaitro_mavaitro_seq'::regclass);


--
-- Name: cskh_broadcast_campaign cskh_broadcast_campaign_pkey; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.cskh_broadcast_campaign
    ADD CONSTRAINT cskh_broadcast_campaign_pkey PRIMARY KEY (id);


--
-- Name: cskh_broadcast_recipient cskh_broadcast_recipient_pkey; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.cskh_broadcast_recipient
    ADD CONSTRAINT cskh_broadcast_recipient_pkey PRIMARY KEY (id);


--
-- Name: api_request_log idx_16648_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.api_request_log
    ADD CONSTRAINT idx_16648_primary PRIMARY KEY (malog);


--
-- Name: audit_log_khachhang idx_16656_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.audit_log_khachhang
    ADD CONSTRAINT idx_16656_primary PRIMARY KEY (maaudit);


--
-- Name: booking_history idx_16664_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.booking_history
    ADD CONSTRAINT idx_16664_primary PRIMARY KEY (malichsu);


--
-- Name: chiphi idx_16673_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chiphi
    ADD CONSTRAINT idx_16673_primary PRIMARY KEY (macp);


--
-- Name: chitietdichvu idx_16680_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietdichvu
    ADD CONSTRAINT idx_16680_primary PRIMARY KEY (mactdv);


--
-- Name: chitietgiaodich idx_16691_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietgiaodich
    ADD CONSTRAINT idx_16691_primary PRIMARY KEY (mactgd);


--
-- Name: chitietphanhoi idx_16704_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietphanhoi
    ADD CONSTRAINT idx_16704_primary PRIMARY KEY (mactphanhoi);


--
-- Name: congnophaithu idx_16712_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.congnophaithu
    ADD CONSTRAINT idx_16712_primary PRIMARY KEY (macongno);


--
-- Name: dichvu idx_16724_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.dichvu
    ADD CONSTRAINT idx_16724_primary PRIMARY KEY (madichvu);


--
-- Name: doan idx_16733_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.doan
    ADD CONSTRAINT idx_16733_primary PRIMARY KEY (madoan);


--
-- Name: ekyc_verification idx_16739_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.ekyc_verification
    ADD CONSTRAINT idx_16739_primary PRIMARY KEY (maekyc);


--
-- Name: giaodich idx_16749_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.giaodich
    ADD CONSTRAINT idx_16749_primary PRIMARY KEY (magiaodich);


--
-- Name: hoadon idx_16762_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.hoadon
    ADD CONSTRAINT idx_16762_primary PRIMARY KEY (mahoadon);


--
-- Name: khachhang idx_16773_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.khachhang
    ADD CONSTRAINT idx_16773_primary PRIMARY KEY (makhachhang);


--
-- Name: khachsan idx_16779_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.khachsan
    ADD CONSTRAINT idx_16779_primary PRIMARY KEY (makhachsan);


--
-- Name: khuyenmai idx_16788_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.khuyenmai
    ADD CONSTRAINT idx_16788_primary PRIMARY KEY (makhuyenmai);


--
-- Name: kiem_toan_dem idx_16796_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.kiem_toan_dem
    ADD CONSTRAINT idx_16796_primary PRIMARY KEY (maktd);


--
-- Name: nhanvien idx_16811_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.nhanvien
    ADD CONSTRAINT idx_16811_primary PRIMARY KEY (manhanvien);


--
-- Name: phanhoi idx_16816_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.phanhoi
    ADD CONSTRAINT idx_16816_primary PRIMARY KEY (maph);


--
-- Name: phong idx_16826_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.phong
    ADD CONSTRAINT idx_16826_primary PRIMARY KEY (maphong);


--
-- Name: room_status_log idx_16838_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.room_status_log
    ADD CONSTRAINT idx_16838_primary PRIMARY KEY (malog);


--
-- Name: taikhoan idx_16845_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.taikhoan
    ADD CONSTRAINT idx_16845_primary PRIMARY KEY (matk);


--
-- Name: thietbi idx_16854_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.thietbi
    ADD CONSTRAINT idx_16854_primary PRIMARY KEY (mathietbi);


--
-- Name: vaitro idx_16861_primary; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.vaitro
    ADD CONSTRAINT idx_16861_primary PRIMARY KEY (mavaitro);


--
-- Name: refund_requests refund_requests_pkey; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.refund_requests
    ADD CONSTRAINT refund_requests_pkey PRIMARY KEY (id);


--
-- Name: refund_requests refund_requests_refund_code_key; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.refund_requests
    ADD CONSTRAINT refund_requests_refund_code_key UNIQUE (refund_code);


--
-- Name: node_sessions session_pkey; Type: CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.node_sessions
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX "IDX_session_expire" ON abc_resort1.node_sessions USING btree (expire);


--
-- Name: cskh_broadcast_campaign_created_at_idx; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX cskh_broadcast_campaign_created_at_idx ON abc_resort1.cskh_broadcast_campaign USING btree (created_at DESC);


--
-- Name: cskh_broadcast_recipient_campaign_idx; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX cskh_broadcast_recipient_campaign_idx ON abc_resort1.cskh_broadcast_recipient USING btree (campaign_id);


--
-- Name: idx_16648_fk_apilog_taikhoan; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16648_fk_apilog_taikhoan ON abc_resort1.api_request_log USING btree (matk);


--
-- Name: idx_16656_idx_audit_hanhdong; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16656_idx_audit_hanhdong ON abc_resort1.audit_log_khachhang USING btree (hanhdong);


--
-- Name: idx_16656_idx_audit_makh; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16656_idx_audit_makh ON abc_resort1.audit_log_khachhang USING btree (makhachhang);


--
-- Name: idx_16656_idx_audit_thoigian; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16656_idx_audit_thoigian ON abc_resort1.audit_log_khachhang USING btree (thoigian);


--
-- Name: idx_16664_fk_bh_giaodich; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16664_fk_bh_giaodich ON abc_resort1.booking_history USING btree (magiaodich);


--
-- Name: idx_16664_fk_bh_khachhang; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16664_fk_bh_khachhang ON abc_resort1.booking_history USING btree (makhachhang);


--
-- Name: idx_16664_fk_bh_phong; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16664_fk_bh_phong ON abc_resort1.booking_history USING btree (maphong);


--
-- Name: idx_16680_madichvu; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16680_madichvu ON abc_resort1.chitietdichvu USING btree (madichvu);


--
-- Name: idx_16680_magiaodich; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16680_magiaodich ON abc_resort1.chitietdichvu USING btree (magiaodich);


--
-- Name: idx_16680_maphong; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16680_maphong ON abc_resort1.chitietdichvu USING btree (maphong);


--
-- Name: idx_16691_fk_ctgd_khuyenmai; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16691_fk_ctgd_khuyenmai ON abc_resort1.chitietgiaodich USING btree (makhuyenmai);


--
-- Name: idx_16691_magiaodich; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16691_magiaodich ON abc_resort1.chitietgiaodich USING btree (magiaodich);


--
-- Name: idx_16691_maphong; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16691_maphong ON abc_resort1.chitietgiaodich USING btree (maphong);


--
-- Name: idx_16704_manhanvien; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16704_manhanvien ON abc_resort1.chitietphanhoi USING btree (manhanvien);


--
-- Name: idx_16704_maphanhoi; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16704_maphanhoi ON abc_resort1.chitietphanhoi USING btree (maphanhoi);


--
-- Name: idx_16712_magiaodich; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16712_magiaodich ON abc_resort1.congnophaithu USING btree (magiaodich);


--
-- Name: idx_16712_makhachhang; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16712_makhachhang ON abc_resort1.congnophaithu USING btree (makhachhang);


--
-- Name: idx_16712_trangthaithanhtoan; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16712_trangthaithanhtoan ON abc_resort1.congnophaithu USING btree (trangthaithanhtoan);


--
-- Name: idx_16733_matruongdoan; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16733_matruongdoan ON abc_resort1.doan USING btree (matruongdoan);


--
-- Name: idx_16739_fk_ekyc_khachhang; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16739_fk_ekyc_khachhang ON abc_resort1.ekyc_verification USING btree (makhachhang);


--
-- Name: idx_16749_madoan; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16749_madoan ON abc_resort1.giaodich USING btree (madoan);


--
-- Name: idx_16749_makhachhang; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16749_makhachhang ON abc_resort1.giaodich USING btree (makhachhang);


--
-- Name: idx_16749_makhuyenmai; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16749_makhuyenmai ON abc_resort1.giaodich USING btree (makhuyenmai);


--
-- Name: idx_16749_manhanvien; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16749_manhanvien ON abc_resort1.giaodich USING btree (manhanvien);


--
-- Name: idx_16762_magiaodich; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16762_magiaodich ON abc_resort1.hoadon USING btree (magiaodich);


--
-- Name: idx_16762_makhachhang; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16762_makhachhang ON abc_resort1.hoadon USING btree (makhachhang);


--
-- Name: idx_16762_manhanvien; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16762_manhanvien ON abc_resort1.hoadon USING btree (manhanvien);


--
-- Name: idx_16773_fk_khachhang_taikhoan; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16773_fk_khachhang_taikhoan ON abc_resort1.khachhang USING btree (matk);


--
-- Name: idx_16788_tenchuongtrinh; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE UNIQUE INDEX idx_16788_tenchuongtrinh ON abc_resort1.khuyenmai USING btree (tenchuongtrinh);


--
-- Name: idx_16796_idx_ngay; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16796_idx_ngay ON abc_resort1.kiem_toan_dem USING btree (ngayktd);


--
-- Name: idx_16796_idx_trangthai; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16796_idx_trangthai ON abc_resort1.kiem_toan_dem USING btree (trangthai);


--
-- Name: idx_16796_mataikhoan; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16796_mataikhoan ON abc_resort1.kiem_toan_dem USING btree (mataikhoan);


--
-- Name: idx_16811_mavaitro; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16811_mavaitro ON abc_resort1.nhanvien USING btree (mavaitro);


--
-- Name: idx_16816_makhachhang; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16816_makhachhang ON abc_resort1.phanhoi USING btree (makhachhang);


--
-- Name: idx_16826_fk_phong_khachsan; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16826_fk_phong_khachsan ON abc_resort1.phong USING btree (makhachsan);


--
-- Name: idx_16826_sophong; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE UNIQUE INDEX idx_16826_sophong ON abc_resort1.phong USING btree (sophong);


--
-- Name: idx_16838_fk_roomlog_giaodich; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16838_fk_roomlog_giaodich ON abc_resort1.room_status_log USING btree (magiaodich);


--
-- Name: idx_16838_fk_roomlog_phong; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16838_fk_roomlog_phong ON abc_resort1.room_status_log USING btree (maphong);


--
-- Name: idx_16845_makhachhang; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16845_makhachhang ON abc_resort1.taikhoan USING btree (makhachhang);


--
-- Name: idx_16845_manhanvien; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16845_manhanvien ON abc_resort1.taikhoan USING btree (manhanvien);


--
-- Name: idx_16845_mavaitro; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16845_mavaitro ON abc_resort1.taikhoan USING btree (mavaitro);


--
-- Name: idx_16845_username; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE UNIQUE INDEX idx_16845_username ON abc_resort1.taikhoan USING btree (username);


--
-- Name: idx_16854_maphong; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_16854_maphong ON abc_resort1.thietbi USING btree (maphong);


--
-- Name: idx_16861_tenvaitro; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE UNIQUE INDEX idx_16861_tenvaitro ON abc_resort1.vaitro USING btree (tenvaitro);


--
-- Name: idx_chiphi_loaichiphi; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_chiphi_loaichiphi ON abc_resort1.chiphi USING btree (loaichiphi);


--
-- Name: idx_chiphi_makhachsan; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_chiphi_makhachsan ON abc_resort1.chiphi USING btree (makhachsan);


--
-- Name: idx_chiphi_ngaychi; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_chiphi_ngaychi ON abc_resort1.chiphi USING btree (ngaychi);


--
-- Name: idx_chiphi_trangthai; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_chiphi_trangthai ON abc_resort1.chiphi USING btree (trangthai);


--
-- Name: idx_refund_requests_bank_txn; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_refund_requests_bank_txn ON abc_resort1.refund_requests USING btree (refund_bank_txn_id);


--
-- Name: idx_refund_requests_created_at; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_refund_requests_created_at ON abc_resort1.refund_requests USING btree (created_at);


--
-- Name: idx_refund_requests_magiaodich; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_refund_requests_magiaodich ON abc_resort1.refund_requests USING btree (magiaodich);


--
-- Name: idx_refund_requests_status; Type: INDEX; Schema: abc_resort1; Owner: -
--

CREATE INDEX idx_refund_requests_status ON abc_resort1.refund_requests USING btree (status);


--
-- Name: chiphi chiphi_makhachsan_fkey; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chiphi
    ADD CONSTRAINT chiphi_makhachsan_fkey FOREIGN KEY (makhachsan) REFERENCES abc_resort1.khachsan(makhachsan);


--
-- Name: chitietdichvu chitietdichvu_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietdichvu
    ADD CONSTRAINT chitietdichvu_ibfk_1 FOREIGN KEY (magiaodich) REFERENCES abc_resort1.giaodich(magiaodich) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chitietdichvu chitietdichvu_ibfk_2; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietdichvu
    ADD CONSTRAINT chitietdichvu_ibfk_2 FOREIGN KEY (maphong) REFERENCES abc_resort1.phong(maphong) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: chitietdichvu chitietdichvu_ibfk_3; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietdichvu
    ADD CONSTRAINT chitietdichvu_ibfk_3 FOREIGN KEY (madichvu) REFERENCES abc_resort1.dichvu(madichvu) ON UPDATE CASCADE;


--
-- Name: chitietgiaodich chitietgiaodich_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietgiaodich
    ADD CONSTRAINT chitietgiaodich_ibfk_1 FOREIGN KEY (magiaodich) REFERENCES abc_resort1.giaodich(magiaodich) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chitietgiaodich chitietgiaodich_ibfk_2; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietgiaodich
    ADD CONSTRAINT chitietgiaodich_ibfk_2 FOREIGN KEY (maphong) REFERENCES abc_resort1.phong(maphong) ON UPDATE CASCADE;


--
-- Name: chitietphanhoi chitietphanhoi_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietphanhoi
    ADD CONSTRAINT chitietphanhoi_ibfk_1 FOREIGN KEY (maphanhoi) REFERENCES abc_resort1.phanhoi(maph) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chitietphanhoi chitietphanhoi_ibfk_2; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietphanhoi
    ADD CONSTRAINT chitietphanhoi_ibfk_2 FOREIGN KEY (manhanvien) REFERENCES abc_resort1.nhanvien(manhanvien) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: congnophaithu congnophaithu_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.congnophaithu
    ADD CONSTRAINT congnophaithu_ibfk_1 FOREIGN KEY (makhachhang) REFERENCES abc_resort1.khachhang(makhachhang);


--
-- Name: cskh_broadcast_recipient cskh_broadcast_recipient_campaign_id_fkey; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.cskh_broadcast_recipient
    ADD CONSTRAINT cskh_broadcast_recipient_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES abc_resort1.cskh_broadcast_campaign(id) ON DELETE CASCADE;


--
-- Name: doan doan_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.doan
    ADD CONSTRAINT doan_ibfk_1 FOREIGN KEY (matruongdoan) REFERENCES abc_resort1.khachhang(makhachhang) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: api_request_log fk_apilog_taikhoan; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.api_request_log
    ADD CONSTRAINT fk_apilog_taikhoan FOREIGN KEY (matk) REFERENCES abc_resort1.taikhoan(matk) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: booking_history fk_bh_giaodich; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.booking_history
    ADD CONSTRAINT fk_bh_giaodich FOREIGN KEY (magiaodich) REFERENCES abc_resort1.giaodich(magiaodich) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: booking_history fk_bh_khachhang; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.booking_history
    ADD CONSTRAINT fk_bh_khachhang FOREIGN KEY (makhachhang) REFERENCES abc_resort1.khachhang(makhachhang) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: booking_history fk_bh_phong; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.booking_history
    ADD CONSTRAINT fk_bh_phong FOREIGN KEY (maphong) REFERENCES abc_resort1.phong(maphong) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chitietgiaodich fk_ctgd_khuyenmai; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.chitietgiaodich
    ADD CONSTRAINT fk_ctgd_khuyenmai FOREIGN KEY (makhuyenmai) REFERENCES abc_resort1.khuyenmai(makhuyenmai) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ekyc_verification fk_ekyc_khachhang; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.ekyc_verification
    ADD CONSTRAINT fk_ekyc_khachhang FOREIGN KEY (makhachhang) REFERENCES abc_resort1.khachhang(makhachhang) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: khachhang fk_khachhang_taikhoan; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.khachhang
    ADD CONSTRAINT fk_khachhang_taikhoan FOREIGN KEY (matk) REFERENCES abc_resort1.taikhoan(matk) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: phong fk_phong_khachsan; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.phong
    ADD CONSTRAINT fk_phong_khachsan FOREIGN KEY (makhachsan) REFERENCES abc_resort1.khachsan(makhachsan);


--
-- Name: room_status_log fk_roomlog_giaodich; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.room_status_log
    ADD CONSTRAINT fk_roomlog_giaodich FOREIGN KEY (magiaodich) REFERENCES abc_resort1.giaodich(magiaodich) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: room_status_log fk_roomlog_phong; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.room_status_log
    ADD CONSTRAINT fk_roomlog_phong FOREIGN KEY (maphong) REFERENCES abc_resort1.phong(maphong) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: giaodich giaodich_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.giaodich
    ADD CONSTRAINT giaodich_ibfk_1 FOREIGN KEY (makhachhang) REFERENCES abc_resort1.khachhang(makhachhang) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: giaodich giaodich_ibfk_2; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.giaodich
    ADD CONSTRAINT giaodich_ibfk_2 FOREIGN KEY (madoan) REFERENCES abc_resort1.doan(madoan) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: giaodich giaodich_ibfk_3; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.giaodich
    ADD CONSTRAINT giaodich_ibfk_3 FOREIGN KEY (manhanvien) REFERENCES abc_resort1.nhanvien(manhanvien) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: giaodich giaodich_ibfk_4; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.giaodich
    ADD CONSTRAINT giaodich_ibfk_4 FOREIGN KEY (makhuyenmai) REFERENCES abc_resort1.khuyenmai(makhuyenmai) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: hoadon hoadon_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.hoadon
    ADD CONSTRAINT hoadon_ibfk_1 FOREIGN KEY (magiaodich) REFERENCES abc_resort1.giaodich(magiaodich) ON UPDATE CASCADE;


--
-- Name: hoadon hoadon_ibfk_2; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.hoadon
    ADD CONSTRAINT hoadon_ibfk_2 FOREIGN KEY (makhachhang) REFERENCES abc_resort1.khachhang(makhachhang) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: hoadon hoadon_ibfk_3; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.hoadon
    ADD CONSTRAINT hoadon_ibfk_3 FOREIGN KEY (manhanvien) REFERENCES abc_resort1.nhanvien(manhanvien) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: kiem_toan_dem kiem_toan_dem_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.kiem_toan_dem
    ADD CONSTRAINT kiem_toan_dem_ibfk_1 FOREIGN KEY (mataikhoan) REFERENCES abc_resort1.taikhoan(matk) ON DELETE SET NULL;


--
-- Name: nhanvien nhanvien_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.nhanvien
    ADD CONSTRAINT nhanvien_ibfk_1 FOREIGN KEY (mavaitro) REFERENCES abc_resort1.vaitro(mavaitro) ON UPDATE CASCADE;


--
-- Name: phanhoi phanhoi_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.phanhoi
    ADD CONSTRAINT phanhoi_ibfk_1 FOREIGN KEY (makhachhang) REFERENCES abc_resort1.khachhang(makhachhang) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: refund_requests refund_requests_expense_id_fkey; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.refund_requests
    ADD CONSTRAINT refund_requests_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES abc_resort1.chiphi(macp);


--
-- Name: refund_requests refund_requests_magiaodich_fkey; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.refund_requests
    ADD CONSTRAINT refund_requests_magiaodich_fkey FOREIGN KEY (magiaodich) REFERENCES abc_resort1.giaodich(magiaodich) ON DELETE CASCADE;


--
-- Name: taikhoan taikhoan_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.taikhoan
    ADD CONSTRAINT taikhoan_ibfk_1 FOREIGN KEY (mavaitro) REFERENCES abc_resort1.vaitro(mavaitro) ON UPDATE CASCADE;


--
-- Name: taikhoan taikhoan_ibfk_2; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.taikhoan
    ADD CONSTRAINT taikhoan_ibfk_2 FOREIGN KEY (makhachhang) REFERENCES abc_resort1.khachhang(makhachhang) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: taikhoan taikhoan_ibfk_3; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.taikhoan
    ADD CONSTRAINT taikhoan_ibfk_3 FOREIGN KEY (manhanvien) REFERENCES abc_resort1.nhanvien(manhanvien) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: thietbi thietbi_ibfk_1; Type: FK CONSTRAINT; Schema: abc_resort1; Owner: -
--

ALTER TABLE ONLY abc_resort1.thietbi
    ADD CONSTRAINT thietbi_ibfk_1 FOREIGN KEY (maphong) REFERENCES abc_resort1.phong(maphong) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 7cpmPgDb208x3foIfxgUBBGdmgF73oO2fa71zFYPhGTVHxRxScdRhOfaKJKptUP

