import { describe, expect, it } from "vitest";
import { aggregatePmsQueueJobs, type PmsQueuedJob } from "./pmsQueueClient";
const job = (id:string,status:PmsQueuedJob["status"], error_message?:string):PmsQueuedJob =>
  ({ id, hotel_id:"slnt-group",status,error_message });
describe("PMS queue status", () => {
  it("never reports success while a second SLNT account is pending", () => {
    expect(aggregatePmsQueueJobs([job("one","success"),job("two","pending")])).toMatchObject({
      status:"queued",complete:false,remaining:1,
    });
  });
  it("reports running without counting a queued manual job as finished", () => {
    expect(aggregatePmsQueueJobs([job("one","running"),job("two","pending")])).toMatchObject({
      status:"queued",remaining:2,running:1,
    });
  });
  it("requires every account to complete", () => {
    expect(aggregatePmsQueueJobs([job("one","success"),job("two","success")])).toMatchObject({
      status:"success",complete:true,remaining:0,
    });
  });
  it("preserves partial coverage and failure, never greenwashing them", () => {
    expect(aggregatePmsQueueJobs([job("one","success"),job("two","partial")]).status).toBe("partial");
    expect(aggregatePmsQueueJobs([job("one","success"),job("two","failed","Previo timed out")])).toMatchObject({
      status:"error",message:"Previo timed out",
    });
  });
  it("fails closed when the job rows cannot be found", () => {
    expect(aggregatePmsQueueJobs([])).toMatchObject({status:"error",complete:true});
  });
});
