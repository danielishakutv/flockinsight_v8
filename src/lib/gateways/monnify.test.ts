import { afterEach, describe, expect, it, vi } from "vitest";
import { monnifyAdapter } from "./monnify";

/*
 * Monnify has two lookups and they take different references.
 * /v2/transactions/{ref} wants Monnify's own transactionReference; we only
 * ever hold OUR paymentReference at verify time (the thanks page and the
 * webhook both hand us that one). Asking the wrong endpoint answers "not
 * found", and every gift a giver had paid stayed pending for ever with no
 * receipt. This pins the endpoint, since nothing else in the app can see it.
 */

const creds = {
  publicKey: "MK_PROD_TEST",
  secret: "secret",
  extra: { contractCode: "123" },
  linkUrl: null,
};

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("monnify verify", () => {
  it("looks the payment up by our paymentReference, on the query endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respond({ requestSuccessful: true, responseBody: { accessToken: "tok" } }),
      )
      .mockResolvedValueOnce(
        respond({
          requestSuccessful: true,
          responseBody: {
            paymentStatus: "PAID",
            amountPaid: 10000,
            currencyCode: "NGN",
            transactionReference: "MNFY|20261021|000123",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await monnifyAdapter.verify(creds, "FI-abc123");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toBe(
      "https://api.monnify.com/api/v2/merchant/transactions/query?paymentReference=FI-abc123",
    );
    expect(res).toEqual({
      ok: true,
      status: "success",
      amount: 10000,
      currency: "NGN",
      gatewayRef: "MNFY|20261021|000123",
      message: "Monnify: PAID",
    });
  });

  it("encodes a reference so it cannot add its own query parameters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respond({ requestSuccessful: true, responseBody: { accessToken: "tok" } }),
      )
      .mockResolvedValueOnce(
        respond({ requestSuccessful: true, responseBody: { paymentStatus: "PENDING" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await monnifyAdapter.verify(creds, "a&b=c");

    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\?paymentReference=a%26b%3Dc$/);
    expect(res.ok && res.status).toBe("pending");
  });
});
