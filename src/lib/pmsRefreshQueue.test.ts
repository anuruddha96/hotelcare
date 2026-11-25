import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { summarizeQueuedPmsJobs } from "@/lib/pmsRefreshQueue";

describe("portfolio PMS refresh queue results", () => {
 it("does not call an enqueued manual refresh completed", () => {
  const result = summarizeQueuedPmsJobs([{target_key:"hotel:ottofiori",status:"running"}]);
  expect(result.status).toBe("syncing");
  expect(result.runningJobs).toBe(1);
 });
 it("shows a waiting job distinctly from a running job", () => {
  const result=summarizeQueuedPmsJobs([
    {target_key:"account:1",status:"success",finished_at:"2026-10-13T12:11:47Z"},
    {target_key:"account:2",status:"queued"},
  ]);
  expect(result).toMatchObject({status:"queued",completedJobs:1,queuedJobs:1,jobCount:2});
 });
 it("reports SLNT's exact partial-sync reason",()=>{
   const result=summarizeQueuedPmsJobs([
     {target_key:"account:1",status:"success",result:{result:{rooms_updated:50}}},
     {target_key:"account:2",status:"partial",result:{result:{account_label:"SLNT PMS 1",unverified_vacancy_rooms:["Park&Garden apartment"],rooms_updated:8,mapped_rooms:9}}},
   ]);
   expect(result.status).toBe("partial");
   expect(result.partialReasons).toEqual(["Unable to verify vacancy for: Park&Garden apartment"]);
   expect(result.managerMessage).toContain("Park&Garden");
   expect(result.jobCount).toBe(2);
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
