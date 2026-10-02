import { describe, it, expect } from "vitest";
import {
  getRegistrableDomain,
  isSameOrSubdomain,
  isCrossOrigin,
  isIpAddress,
  isValidHostname,
  safeParseUrl,
  getHostname
} from "../src/lib/url-utils";

describe("url-utils", () => {
  it("computes registrable domain for simple domains", () => {
    expect(getRegistrableDomain("example.com")).toBe("example.com");
    expect(getRegistrableDomain("shop.example.com")).toBe("example.com");
    expect(getRegistrableDomain("a.b.shop.example.com")).toBe("example.com");
  });

  it("handles known multi-label public suffixes", () => {
    expect(getRegistrableDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(getRegistrableDomain("example.co.uk")).toBe("example.co.uk");
  });

  it("leaves IP addresses and localhost unchanged", () => {
    expect(getRegistrableDomain("192.168.1.10")).toBe("192.168.1.10");
    expect(getRegistrableDomain("localhost")).toBe("localhost");
  });

  it("subdomain matching never crosses to unrelated domains", () => {
    expect(isSameOrSubdomain("example.com", "example.com")).toBe(true);
    expect(isSameOrSubdomain("sub.example.com", "example.com")).toBe(true);
    expect(isSameOrSubdomain("notexample.com", "example.com")).toBe(false);
    expect(isSameOrSubdomain("example.com.evil.net", "example.com")).toBe(false);
  });

  it("detects cross-origin correctly using registrable domain", () => {
    expect(isCrossOrigin("https://shop.example.com", "https://checkout.example.com/pay")).toBe(false);
    expect(isCrossOrigin("https://example.com", "https://ads.example-ad.com")).toBe(true);
  });

  it("validates hostnames without throwing on malformed input", () => {
    expect(isValidHostname("")).toBe(false);
    expect(isValidHostname("example.com")).toBe(true);
    expect(isValidHostname("not a host!!")).toBe(false);
  });

  it("identifies IPv4 addresses", () => {
    expect(isIpAddress("192.168.1.1")).toBe(true);
    expect(isIpAddress("999.999.999.999")).toBe(false);
    expect(isIpAddress("example.com")).toBe(false);
  });

  it("safely parses malformed URLs without throwing", () => {
    expect(safeParseUrl("not a url")).toBeNull();
    expect(safeParseUrl("https://example.com")).not.toBeNull();
  });

  it("getHostname is null-safe on malformed input", () => {
    expect(getHostname("not a url at all")).toBeNull();
    expect(getHostname("https://example.com/path")).toBe("example.com");
  });
});
