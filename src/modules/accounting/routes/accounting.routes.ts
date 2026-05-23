import { Router } from "express";
import { requireRole } from "../../../shared/auth/guards";
import { ROLE } from "../../../shared/constants/roles";
import { asyncHandler } from "../../../shared/http/async-handler";
import {
  accountingDashboardApi,
  cashflowApi,
  createExpenseAction,
  createExpenseApi,
  debtApi,
  expenseApi,
  renderAccountingDashboard,
  renderAccountingReports,
  renderCashflowPage,
  renderDebtPage,
  renderExpensePage,
  renderRefundPage,
  renderRevenuePage,
  processRefundAction,
  processRefundApi,
  refundApi,
  reportAiInsightsApi,
  reportApi,
  revenueApi
} from "../controllers/accounting.controller";

export const accountingRouter = Router();
export const accountingApiRouter = Router();

accountingRouter.get("/", requireRole([ROLE.KE_TOAN]), asyncHandler(renderAccountingDashboard));
accountingRouter.get("/reports", requireRole([ROLE.KE_TOAN]), asyncHandler(renderAccountingReports));
accountingRouter.get("/revenue", requireRole([ROLE.KE_TOAN]), asyncHandler(renderRevenuePage));
accountingRouter.get("/expenses", requireRole([ROLE.KE_TOAN]), asyncHandler(renderExpensePage));
accountingRouter.get("/cashflow", requireRole([ROLE.KE_TOAN]), asyncHandler(renderCashflowPage));
accountingRouter.get("/debts", requireRole([ROLE.KE_TOAN]), asyncHandler(renderDebtPage));
accountingRouter.get("/refunds", requireRole([ROLE.KE_TOAN]), asyncHandler(renderRefundPage));
accountingRouter.post("/expenses", requireRole([ROLE.KE_TOAN]), asyncHandler(createExpenseAction));
accountingRouter.post("/refunds/process", requireRole([ROLE.KE_TOAN]), asyncHandler(processRefundAction));

accountingApiRouter.get("/dashboard", requireRole([ROLE.KE_TOAN, ROLE.ADMIN]), asyncHandler(accountingDashboardApi));
accountingApiRouter.get("/reports", requireRole([ROLE.KE_TOAN, ROLE.ADMIN]), asyncHandler(reportApi));
accountingApiRouter.get("/reports/ai-insights", requireRole([ROLE.KE_TOAN, ROLE.ADMIN]), asyncHandler(reportAiInsightsApi));
accountingApiRouter.get("/revenue", requireRole([ROLE.KE_TOAN, ROLE.ADMIN]), asyncHandler(revenueApi));
accountingApiRouter.get("/expenses", requireRole([ROLE.KE_TOAN, ROLE.ADMIN]), asyncHandler(expenseApi));
accountingApiRouter.get("/cashflow", requireRole([ROLE.KE_TOAN, ROLE.ADMIN]), asyncHandler(cashflowApi));
accountingApiRouter.get("/debts", requireRole([ROLE.KE_TOAN, ROLE.ADMIN]), asyncHandler(debtApi));
accountingApiRouter.get("/refunds", requireRole([ROLE.KE_TOAN, ROLE.ADMIN]), asyncHandler(refundApi));
accountingApiRouter.post("/expenses", requireRole([ROLE.KE_TOAN, ROLE.ADMIN]), asyncHandler(createExpenseApi));
accountingApiRouter.post("/refunds/process", requireRole([ROLE.KE_TOAN, ROLE.ADMIN]), asyncHandler(processRefundApi));
