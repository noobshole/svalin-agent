import { z } from "zod";

import { recipientCheckSchema } from "./check.js";
import { riskReportSchema } from "./risk.js";
import { apiErrorSchema } from "./service.js";

/**
 * One scan of an address, as the website shows it: is it safe to pay (the recipient check), and
 * how risky is the money it holds (the risk report). GET /v1/demo/scan answers both for one free
 * call, and GET /v1/scan for one paid call (one call with a Svalin key or Pro code).
 */
export const addressScanSchema = z.object({
  check: recipientCheckSchema,
  /** Null when the address has no report, such as a token, and `reportError` says why. */
  report: riskReportSchema.nullable(),
  /** Why there is no report: the error the risk route would have answered, with its status. */
  reportError: apiErrorSchema.extend({ status: z.number().int() }).nullable(),
});

export type AddressScan = z.infer<typeof addressScanSchema>;
