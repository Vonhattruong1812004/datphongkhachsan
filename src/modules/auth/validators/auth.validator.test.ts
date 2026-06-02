import test from "node:test";
import assert from "node:assert/strict";
import { registerSchema } from "./auth.validator";

test("registerSchema chuan hoa username, email, sdt va cccd hop le", () => {
  const parsed = registerSchema.parse({
    fullname: "  Nguyen   Van A  ",
    username: "User_01",
    password: "Abc@12345",
    repass: "Abc@12345",
    email: "USER01@Example.COM ",
    sdt: "+84901234567",
    cccd: "012 345 678 901"
  });

  assert.equal(parsed.fullname, "Nguyen Van A");
  assert.equal(parsed.username, "user_01");
  assert.equal(parsed.email, "user01@example.com");
  assert.equal(parsed.sdt, "0901234567");
  assert.equal(parsed.cccd, "012345678901");
});

test("registerSchema chan username, sdt, cccd va mat khau khong dat regex", () => {
  assert.throws(() => registerSchema.parse({
    fullname: "Nguyen Van A",
    username: "1bad",
    password: "abc123",
    repass: "abc123",
    email: "bad@example.com",
    sdt: "0112345678",
    cccd: "1234567890"
  }));
});
