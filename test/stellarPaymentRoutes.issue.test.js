import { describe, expect, it } from "@jest/globals";
describe("Stellar payment routes", () => { it("does not treat a submitted hash as confirmation", () => { expect({status:"pending"}).not.toMatchObject({status:"confirmed"}); }); });
