import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { summarizeQueuedPmsJobs } from "@/lib/pmsRefreshQueue";

describe("portfolio PMS refresh queue results", () => {
 it("does not call an enqueued manual refresh completed", () => {
  const result = summarizeQueuedPmsJobs([{target_key:"hotel:ottofiori",status:"running"}]);
  expect(result.status).toBe("queued");
  expect(result.managerMessage).toContain("queued");
 });
 it("reports a fully reconciled morning hotel", () => {
  const result = summarizeQueuedPmsJobs([{
   target_key:"hotel:ottofiori",status:"success",
   result:{result:{rooms_updated:21,expected_mapped_rooms:21,checkout_rooms:12}},
  }]);
  expect(result).toMatchObject({status:"success",updated:21,total:21,checkouts:12});
 });
 it("never tells the manager that failed accounts synced successfully", () => {
  const result = summarizeQueuedPmsJobs([
   {target_key:"account:one",status:"success",result:{result:{rooms_updated:9}}},
   {target_key:"account:two",status:"failed",error_message:"Previo unavailable"},
  ]);
  expect(result.status).toBe("error");
  expect(result.errors).toContain("account:two: Previo unavailable");
 });
 it("keeps an SLNT group pending until every account finishes", () => {
  const result = summarizeQueuedPmsJobs([
   {target_key:"account:one",status:"success"},
   {target_key:"account:two",status:"queued"},
  ]);
  expect(result.status).toBe("queued");
 });
});
