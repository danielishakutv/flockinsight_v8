import { describe, expect, it } from "vitest";
import { isForbiddenAddress, isAllowedLogoUrl } from "@/lib/pdf-brand";

/**
 * church.logo is free text any church admin can set, and signing up is open.
 * Before the guard, that meant a stranger could point the server at whatever
 * they liked. These are the cases that must stay shut.
 */
describe("isForbiddenAddress", () => {
  it("refuses loopback", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) {
      expect(isForbiddenAddress(ip), ip).toBe(true);
    }
  });

  it("refuses the private ranges", () => {
    for (const ip of ["10.0.0.5", "172.16.4.1", "172.31.255.254", "192.168.1.1"]) {
      expect(isForbiddenAddress(ip), ip).toBe(true);
    }
  });

  it("refuses link-local, which is where cloud metadata lives", () => {
    expect(isForbiddenAddress("169.254.169.254")).toBe(true);
    expect(isForbiddenAddress("fe80::1")).toBe(true);
  });

  it("refuses the unspecified address and unique-local IPv6", () => {
    expect(isForbiddenAddress("0.0.0.0")).toBe(true);
    expect(isForbiddenAddress("::")).toBe(true);
    expect(isForbiddenAddress("fd00::1")).toBe(true);
  });

  it("refuses anything that is not an address at all", () => {
    expect(isForbiddenAddress("not-an-ip")).toBe(true);
    expect(isForbiddenAddress("")).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "104.16.0.1", "2606:4700::1111"]) {
      expect(isForbiddenAddress(ip), ip).toBe(false);
    }
  });

  it("does not mistake 172.15 or 172.32 for the private block", () => {
    expect(isForbiddenAddress("172.15.0.1")).toBe(false);
    expect(isForbiddenAddress("172.32.0.1")).toBe(false);
  });
});

describe("isAllowedLogoUrl", () => {
  it("allows our own uploads", () => {
    expect(isAllowedLogoUrl("https://res.cloudinary.com/demo/image/upload/x.png")).toBe(
      true,
    );
  });

  it("refuses the neighbours on this box", () => {
    // aictig on 3001, Platinum Kitchen on 3003, dinki on 3101, Webmin on 10000.
    for (const url of [
      "http://127.0.0.1:3001/",
      "https://localhost:3003/",
      "http://[::1]:3101/",
      "https://127.0.0.1:10000/",
    ]) {
      expect(isAllowedLogoUrl(url), url).toBe(false);
    }
  });

  it("refuses cloud metadata", () => {
    expect(isAllowedLogoUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("refuses any host we did not put on the list", () => {
    expect(isAllowedLogoUrl("https://evil.example.com/logo.png")).toBe(false);
    // A lookalike must not pass on a suffix match.
    expect(isAllowedLogoUrl("https://res.cloudinary.com.evil.test/x.png")).toBe(false);
  });

  it("refuses plain http even on an allowed host", () => {
    expect(isAllowedLogoUrl("http://res.cloudinary.com/demo/x.png")).toBe(false);
  });

  it("refuses schemes that are not http at all", () => {
    for (const url of [
      "file:///etc/passwd",
      "gopher://127.0.0.1:3001/",
      "data:image/png;base64,AAAA",
    ]) {
      expect(isAllowedLogoUrl(url), url).toBe(false);
    }
  });

  it("refuses a malformed URL rather than throwing", () => {
    expect(isAllowedLogoUrl("not a url")).toBe(false);
    expect(isAllowedLogoUrl("")).toBe(false);
  });
});
